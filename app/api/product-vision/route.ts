import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseLabel, type OcrItem } from '@/lib/parseLabel';
import { readLabelText, readBackFields } from '@/lib/visionOcr';
import { structureLabel, GROQ_ENABLED } from '@/lib/labelStructure';

/**
 * Label OCR: client posts a product photo. We read the label with the best
 * reader available and return a best-guess {name, brand, flavor, quantity,
 * price}. The scan form stays editable so the user fixes any misreads.
 *
 * Reader order (never dead-ends):
 *   1. PaddleOCR-VL on the host GPU — the reader. Slower (~8-15s on a GTX 1050)
 *      but reads stylised/curved label fonts far more cleanly than the sidecar
 *      ("Dreamflower" vs "Nulate Y", "Fogg" vs "Pagrana"). Accuracy first.
 *   2. PP-OCRv5 sidecar (CPU, free) — rescue ONLY: used when the GPU server is
 *      unreachable, or the VLM returned nothing usable, so a scan never fails
 *      outright. It is not in the normal path.
 */
const OCR_URL = process.env.OCR_URL || 'http://localhost:4000';
const MAX_BYTES = 12 * 1024 * 1024;

async function readWithSidecar(buf: ArrayBuffer): Promise<ReturnType<typeof parseLabel> | null> {
    const res = await fetch(`${OCR_URL}/ocr`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: buf,
        signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
        console.warn('OCR sidecar returned', res.status);
        return null;
    }
    const ocr: { text?: string; items?: OcrItem[] } = await res.json();
    return parseLabel(ocr.items ?? [], ocr.text ?? '');
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength < 100) {
        return NextResponse.json({ success: false, message: 'Empty image' }, { status: 400 });
    }
    if (buf.byteLength > MAX_BYTES) {
        return NextResponse.json({ success: false, message: 'Image too large' }, { status: 413 });
    }

    try {
        // Back shot (?side=back): the user only wants size + price. Ask the VLM
        // for just those two fields — tiny output, ~7s instead of transcribing
        // the whole panel (~35s). Falls through to the full read if the targeted
        // reader is unreachable, so it never dead-ends.
        const side = new URL(request.url).searchParams.get('side');
        if (side === 'back') {
            const fields = await readBackFields(buf);
            if (fields) {
                console.log('[vision:back]', JSON.stringify(fields));
                return NextResponse.json({
                    success: !!(fields.quantity || fields.price),
                    data: { name: '', brand: '', flavor: '', quantity: fields.quantity, price: fields.price, rawText: '', backPanel: true, confident: false },
                });
            }
        }

        // Whether a parse is good enough to ship: a front shot needs a name; a
        // back/nutrition panel just needs the net quantity.
        const isUsable = (p: ReturnType<typeof parseLabel> | null) =>
            !!p && (p.backPanel ? !!p.quantity : !!p.name);

        // 1. PaddleOCR-VL is the reader (accuracy first). 2. Fall back to the CPU
        //    sidecar only if the VLM is unreachable or read nothing usable, so a
        //    scan never dead-ends — but every normal scan uses the VLM.
        let reader = 'paddleocr-vl';
        const vlmText = await readLabelText(buf);
        let parsed = vlmText ? parseLabel([], vlmText) : null;
        if (!isUsable(parsed)) {
            const sc = await readWithSidecar(buf);
            if (sc && (isUsable(sc) || !parsed)) {
                reader = 'ppocrv5';
                parsed = sc;
            }
        }
        if (!parsed) {
            return NextResponse.json({ success: false, message: 'OCR failed' }, { status: 502 });
        }

        // Structuring layer: an LLM decides brand/name/flavor from the OCR text —
        // the call regex can't make ("is 500 EXTRA the brand or POND'S?"). With
        // Groq (70B) as primary it runs on every front, including confident ones:
        // the regex picks the biggest line as brand and gets promos like "500
        // EXTRA" wrong, which the 70B fixes. The old confident-skip only applied
        // because the weak local 0.5b/1.5b swapped brand/name — so we keep that
        // gate only when Groq is unavailable. Front only; price/qty/back stay with
        // the deterministic regex. Fail-soft: LLM down → keep regex guesses.
        let structured = false;
        if (!parsed.backPanel && (GROQ_ENABLED || !parsed.confident)) {
            const fields = await structureLabel(parsed.rawText);
            if (fields) {
                structured = true;
                // LLM owns brand/name — it makes the "is SWING a brand or a name?"
                // call that regex can't. Flavor stays with parseLabel's dictionary
                // (the LLM drops flavors inconsistently); only fill from the LLM
                // when the dictionary found nothing.
                if (fields.brand) parsed.brand = fields.brand;
                if (fields.name) parsed.name = fields.name;
                if (!parsed.flavor) parsed.flavor = fields.flavor;
            }
        }

        // Audit: which reader + whether the LLM structured it, the raw text, and
        // the parsed fields — makes misreads debuggable from logs.
        console.log('[vision]', JSON.stringify({
            reader, structured, raw: parsed.rawText, name: parsed.name, brand: parsed.brand,
            flavor: parsed.flavor, quantity: parsed.quantity, price: parsed.price, backPanel: parsed.backPanel,
        }));

        // On a back/nutrition panel the brand and product name aren't present
        // (they live on the front) — the "name" we'd pick is admin/nutrition
        // junk. Drop it and let the client nudge the user to shoot the front.
        // The net quantity, if found, is still useful.
        if (parsed.backPanel) {
            parsed.name = '';
            parsed.brand = '';
        }

        return NextResponse.json({ success: isUsable(parsed), data: parsed });
    } catch (err: any) {
        console.warn('product-vision error:', err?.message || err);
        return NextResponse.json({ success: false, message: 'OCR service unavailable' }, { status: 503 });
    }
}

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseLabel, type OcrItem } from '@/lib/parseLabel';
import { readLabelText } from '@/lib/visionOcr';
import { structureLabel } from '@/lib/labelStructure';

/**
 * Label OCR: client posts a product photo. We read the label with the best
 * reader available and return a best-guess {name, brand, flavor, quantity,
 * price}. The scan form stays editable so the user fixes any misreads.
 *
 * Reader order (never dead-ends):
 *   1. PP-OCRv5 sidecar (CPU, free, always present) — FAST (~1-3s) and, with the
 *      qwen structuring layer cleaning its text, as accurate on brand/flavor as
 *      the VLM. This is the hot path.
 *   2. PaddleOCR-VL on the host GPU — slower (~8-15s on a GTX 1050) but reads
 *      messy shots a touch better; used only when the sidecar finds nothing
 *      usable, so the wait is paid rarely instead of every scan.
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
        // Whether a parse is good enough to ship: a front shot needs a name; a
        // back/nutrition panel just needs the net quantity.
        const isUsable = (p: ReturnType<typeof parseLabel> | null) =>
            !!p && (p.backPanel ? !!p.quantity : !!p.name);

        // 1. PP-OCRv5 sidecar first — fast, and good enough once qwen structures
        //    the text. 2. Only if it found nothing usable, pay for PaddleOCR-VL.
        let reader = 'ppocrv5';
        let vlmText: string | null = null;
        let parsed = await readWithSidecar(buf);
        if (!isUsable(parsed)) {
            vlmText = await readLabelText(buf);
            if (vlmText) {
                reader = 'paddleocr-vl';
                parsed = parseLabel([], vlmText);
            }
        }
        if (!parsed) {
            return NextResponse.json({ success: false, message: 'OCR failed' }, { status: 502 });
        }

        // Structuring layer: a small LLM decides brand/name/flavor from the OCR
        // text — the call regex can't make ("is SWING a brand or a name?").
        // Front only; price/qty/backPanel stay with the deterministic regex.
        // Fail-soft: if the LLM is unavailable we keep parseLabel's guesses.
        let structured = false;
        if (!parsed.backPanel) {
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
            reader, structured, raw: vlmText ?? parsed.rawText, name: parsed.name, brand: parsed.brand,
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

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseLabel, type OcrItem } from '@/lib/parseLabel';
import { readLabelText } from '@/lib/visionOcr';

/**
 * Label OCR: client posts a product photo. We read the label with the best
 * reader available and return a best-guess {name, brand, flavor, quantity,
 * price}. The scan form stays editable so the user fixes any misreads.
 *
 * Reader order (never dead-ends):
 *   1. PaddleOCR-VL on the host GPU (cleaner text) — if VISION_OCR_URL is set
 *      and the server is up.
 *   2. PP-OCRv5 sidecar (CPU, free, always present) — fallback.
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
        // 1. Try PaddleOCR-VL (cleaner). 2. Fall back to the PP-OCRv5 sidecar.
        let parsed: ReturnType<typeof parseLabel> | null = null;
        let reader = 'paddleocr-vl';
        const vlmText = await readLabelText(buf);
        if (vlmText) {
            parsed = parseLabel([], vlmText);
        } else {
            reader = 'ppocrv5';
            parsed = await readWithSidecar(buf);
        }
        if (!parsed) {
            return NextResponse.json({ success: false, message: 'OCR failed' }, { status: 502 });
        }

        // Audit: which reader ran + what it parsed — makes misreads debuggable via logs.
        console.log('[vision]', JSON.stringify({
            reader, name: parsed.name, brand: parsed.brand,
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

        const useful = parsed.backPanel ? !!parsed.quantity : !!parsed.name;
        return NextResponse.json({ success: useful, data: parsed });
    } catch (err: any) {
        console.warn('product-vision error:', err?.message || err);
        return NextResponse.json({ success: false, message: 'OCR service unavailable' }, { status: 503 });
    }
}

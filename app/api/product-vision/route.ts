import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { parseLabel, type OcrItem } from '@/lib/parseLabel';

/**
 * Label OCR: client posts a product photo, we run it through the internal OCR
 * sidecar (PP-OCRv5, no AI/no cost) and return best-guess {name, brand,
 * quantity}. The scan form stays editable so the user fixes any misreads.
 */
const OCR_URL = process.env.OCR_URL || 'http://localhost:4000';
const MAX_BYTES = 12 * 1024 * 1024;

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
        const res = await fetch(`${OCR_URL}/ocr`, {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream' },
            body: buf,
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
            console.warn('OCR sidecar returned', res.status);
            return NextResponse.json({ success: false, message: 'OCR failed' }, { status: 502 });
        }
        const ocr: { text?: string; items?: OcrItem[] } = await res.json();
        const parsed = parseLabel(ocr.items ?? [], ocr.text ?? '');

        if (!parsed.name) {
            return NextResponse.json(
                { success: false, message: 'Could not read the label', data: { rawText: parsed.rawText } },
                { status: 200 },
            );
        }
        return NextResponse.json({ success: true, data: parsed });
    } catch (err: any) {
        console.warn('product-vision error:', err?.message || err);
        return NextResponse.json({ success: false, message: 'OCR service unavailable' }, { status: 503 });
    }
}

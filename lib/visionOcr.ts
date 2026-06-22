/**
 * Higher-quality label reader: PaddleOCR-VL (0.9B) served by llama.cpp's
 * llama-server with an OpenAI-compatible API, running on the host GPU.
 *
 * It transcribes a label far more cleanly than the PP-OCRv5 sidecar (e.g. it
 * reads "NO ADDED SUGAR" instead of the garbled "NO SER"), but returns PLAIN
 * TEXT with no bounding boxes — so parseLabel handles it in line-text mode.
 *
 * Intentionally lazy and fail-soft: if the server is unreachable it returns
 * null and the caller falls back to the PP-OCRv5 sidecar. Never dead-ends.
 */

const VISION_OCR_URL = process.env.VISION_OCR_URL || '';
const ENABLED = !!VISION_OCR_URL && process.env.VISION_OCR_ENABLED !== 'false';

// Cheap reachability probe so a stopped server never blocks a scan for long.
let lastProbe = { at: 0, ok: false };
async function reachable(): Promise<boolean> {
    if (!ENABLED) return false;
    if (Date.now() - lastProbe.at < 30_000) return lastProbe.ok; // cache 30s
    try {
        const res = await fetch(`${VISION_OCR_URL}/health`, { signal: AbortSignal.timeout(1500) });
        lastProbe = { at: Date.now(), ok: res.ok };
    } catch {
        lastProbe = { at: Date.now(), ok: false };
    }
    return lastProbe.ok;
}

/**
 * Transcribe all text on a product label. Returns the raw text (newline-separated
 * lines, reading order) or null if the vision reader is unavailable/empty.
 */
export async function readLabelText(image: ArrayBuffer): Promise<string | null> {
    if (!(await reachable())) return null;
    try {
        const b64 = Buffer.from(image).toString('base64');
        const res = await fetch(`${VISION_OCR_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'paddleocr-vl',
                temperature: 0,
                stream: false,
                // Bounds worst-case decode time: a real label (even a dense back
                // panel) transcribes well under this; the cap only kills the rare
                // runaway/repeat loop that otherwise burns seconds on the GPU.
                // ponytail: 1024 is the ceiling; lower it if back panels never run long.
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        // This exact phrasing gives full top-to-bottom coverage; a
                        // terse "OCR:" truncates and drops peripheral text.
                        { type: 'text', text: 'Recognize all the text in the image.' },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
                    ],
                }],
            }),
            signal: AbortSignal.timeout(30_000), // first call may cold-load the model
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch {
        return null;
    }
}

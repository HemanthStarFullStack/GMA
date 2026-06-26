/**
 * Label reader: Qwen3-VL-2B (Q4) served by llama.cpp's llama-server with an
 * OpenAI-compatible API, on the host GPU. Replaced PaddleOCR-VL — reads labels
 * as cleanly but is an instruction-following VLM, so the back panel can be asked
 * for just the net qty + MRP instead of transcribing the whole panel (~7s vs
 * ~35s). Front still transcribes everything; parseLabel + Groq structure it.
 *
 * Two modes:
 *  - 'full' (front): transcribe all text, returned for parseLabel/Groq.
 *  - 'back': targeted — return only "NET=<v>|MRP=<v>", grounded (no math/guess),
 *    which the caller parses for size + price. Fast because the output is tiny.
 *
 * Fail-soft: if the server is unreachable it returns null and the caller falls
 * back to the PP-OCRv5 sidecar. Never dead-ends.
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

// Front: full transcription for parseLabel + Groq.
const FULL_PROMPT = 'Recognize all the text in the image.';
// Back: ask only for the net quantity (size). Grounded — copy printed digits,
// never compute or infer (a promo "50 g EXTRA" must stay "50 g EXTRA", not become
// "100 g"). Price is deliberately NOT asked: a 2B model fabricates a plausible
// MRP even when none is printed, and a wrong price is worse than no price — so
// price stays with parseLabel's regex / manual entry.
const BACK_PROMPT =
    'What is the net quantity (net weight or volume) printed on this package? ' +
    'Examples: "200 g", "1 L", "39 g", "250 ml". Copy it exactly as printed - do not calculate ' +
    'or guess. If no net quantity is printed, reply exactly NONE. Output only the value, nothing else.';

/**
 * Read a product label with the vision model.
 *  - mode 'full' (default): transcribe all text, top to bottom.
 *  - mode 'back': targeted "NET=<v>|MRP=<v>" (tiny output → fast).
 * Returns the raw model text, or null if the reader is unavailable/empty.
 */
export async function readLabelText(image: ArrayBuffer, mode: 'full' | 'back' = 'full'): Promise<string | null> {
    if (!(await reachable())) return null;
    try {
        const b64 = Buffer.from(image).toString('base64');
        const res = await fetch(`${VISION_OCR_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen3-vl',
                temperature: 0,
                stream: false,
                // Back is two short fields; front may be a dense panel. Cap each to
                // bound decode time (the back cap is what makes it ~7s not ~35s).
                max_tokens: mode === 'back' ? 64 : 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: mode === 'back' ? BACK_PROMPT : FULL_PROMPT },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
                    ],
                }],
            }),
            // A dense front transcription can still take ~25-40s on the GTX 1050;
            // 60s avoids aborting mid-read into the garbage CPU sidecar. Back mode
            // returns in seconds.
            signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
            console.warn(`[reader] VLM HTTP ${res.status} (mode=${mode}) — falling back to OCR sidecar`);
            return null;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch (e) {
        console.warn(`[reader] VLM request failed (mode=${mode}): ${(e as Error).message} — falling back to OCR sidecar`);
        return null;
    }
}

/**
 * Targeted back-panel read for the net quantity (size). Returns { quantity, price }
 * (price always '' — see BACK_PROMPT) with quantity copied verbatim from the pack,
 * or '' when none is printed. Returns null only if the reader was unreachable.
 */
export async function readBackFields(image: ArrayBuffer): Promise<{ quantity: string; price: string } | null> {
    const raw = await readLabelText(image, 'back');
    if (raw == null) return null;
    let quantity = raw.trim().replace(/^["']|["']$/g, '').trim();
    // "NONE" or anything without a digit isn't a real quantity.
    if (/^none$/i.test(quantity) || !/\d/.test(quantity)) quantity = '';
    return { quantity, price: '' };
}

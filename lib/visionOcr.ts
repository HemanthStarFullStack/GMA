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

// Front reader: Gemini flash reads labels ~10x faster than the local 2B VLM
// (~2-4s vs 25-40s) and scored brand/name 100% vs 93/71% in the 35-scan eval,
// while freeing the local GPU during scans. Local VLM + CPU sidecar stay as the
// fallback chain so a Gemini outage never dead-ends a scan. Back-panel reads keep
// the local targeted reader (it beat Gemini there and is already fast).
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const FRONT_READER = process.env.FRONT_READER || (GEMINI_KEY ? 'gemini' : 'local');
// flash first (stronger OCR); flash-lite is spillover (and prod's predictor
// already burns its quota), each model a separate free-tier bucket.
const GEMINI_READ_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

async function geminiRead(b64: string, prompt: string): Promise<string | null> {
    if (!GEMINI_KEY) return null;
    const body = {
        contents: [{ role: 'user', parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } },
        ] }],
        // thinkingBudget 0: no extended thinking (it eats the output budget and
        // returns empty content with finishReason MAX_TOKENS on 2.5 models).
        generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
    };
    for (const model of GEMINI_READ_MODELS) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
            if (!res.ok) {
                if (res.status === 429) continue; // quota — spill to next model
                console.warn(`[reader] Gemini ${model} HTTP ${res.status} — falling back to local VLM`);
                return null;
            }
            const d = await res.json();
            const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof t === 'string' && t.trim()) return t.trim();
        } catch (e) {
            console.warn(`[reader] Gemini ${model} failed: ${(e as Error).message} — falling back to local VLM`);
        }
    }
    return null;
}

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

// Front: full transcription for parseLabel + Groq. The bare "recognize all the
// text" prompt made the VLM summarise — it returned only the hero lines (brand +
// product type) and dropped the small print, so the net quantity ("1 L" on an
// Aquafina bottle) never reached parseLabel and the size came up blank. Spell out
// that the small print, especially net quantity/volume, must be included, and
// suppress the chatty "Here's the text I recognized…" preamble.
const FULL_PROMPT =
    'Transcribe ALL text printed on this product label, exactly as written, top to bottom. ' +
    'Include the small print, especially the net quantity / net weight / volume ' +
    '(e.g. "1 L", "500 ml", "200 g", "1 Litre"), MRP/price, brand, product name and variant. ' +
    'Do not summarise, translate, or omit anything. Output only the transcribed text, no commentary.';
// Back: ask only for the net quantity (size). Grounded — copy printed digits,
// never compute or infer. "Ignore serving size" added explicitly because Gemini
// sometimes returns the nutrition-table per-portion value instead of the total.
// Price is deliberately NOT asked: a 2B model fabricates a plausible MRP even
// when none is printed, and a wrong price is worse than no price.
const BACK_PROMPT =
    'What is the total net quantity (net weight or volume) of the whole package? ' +
    'Examples: "200 g", "1 L", "39 g", "250 ml". Copy it exactly as printed — do not calculate, ' +
    'convert, or guess. Ignore serving size and per-portion figures — return only the total package amount. ' +
    'If no net quantity is printed, reply exactly NONE. Output only the value, nothing else.';

/**
 * Read a product label with the vision model.
 *  - mode 'full' (default): transcribe all text, top to bottom.
 *  - mode 'back': targeted "NET=<v>|MRP=<v>" (tiny output → fast).
 * Returns the raw model text, or null if the reader is unavailable/empty.
 */
export async function readLabelText(image: ArrayBuffer, mode: 'full' | 'back' = 'full'): Promise<string | null> {
    const b64 = Buffer.from(image).toString('base64');
    // Front: cloud reader first (fast, frees the GPU). On miss fall through to the
    // local VLM below; if that's down too the caller drops to the CPU sidecar.
    if (FRONT_READER === 'gemini') {
        const g = await geminiRead(b64, mode === 'back' ? BACK_PROMPT : FULL_PROMPT);
        if (g) return g;
        console.warn('[reader] Gemini returned nothing — trying local VLM');
    }
    if (!(await reachable())) return null;
    try {
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
// Capture groups: (numeric)(unit) — used by largestSize to pick the net weight
// when multiple figures appear (e.g. "Serving 13 g / Net Wt 39 g").
const SIZE_RE = /\b(\d+(?:[.,]\d+)?)\s?(ml|l|ltr|litre|liter|cl|kg|g|gm|gms|gram|grams|mg|pcs?|pieces?|x|n|units?|caps?|capsules?|tablets?|sachets?)\b/gi;
// Base-unit multipliers for normalised comparison. g and ml are 1; larger
// units scale up so "1 kg" beats "500 g" and "1 L" beats "200 ml".
const UNIT_SCALE: Record<string, number> = {
    mg: 0.001, g: 1, gm: 1, gms: 1, gram: 1, grams: 1, kg: 1000,
    ml: 1, cl: 10, l: 1000, ltr: 1000, litre: 1000, liter: 1000,
};
function largestSize(raw: string): string {
    const matches = [...raw.matchAll(SIZE_RE)];
    if (matches.length === 0) return '';
    if (matches.length === 1) return matches[0][0].trim();
    // Multiple candidates — the total net weight is always the largest printed
    // figure; serving size and promo add-ons ("+25 g extra") are smaller.
    return matches
        .map(m => ({ text: m[0].trim(), norm: parseFloat(m[1].replace(',', '.')) * (UNIT_SCALE[m[2].toLowerCase()] ?? 1) }))
        .sort((a, b) => b.norm - a.norm)[0].text;
}

export async function readBackFields(image: ArrayBuffer): Promise<{ quantity: string; price: string } | null> {
    const raw = await readLabelText(image, 'back');
    if (raw == null) return null;
    const cleaned = raw.trim().replace(/^["']|["']$/g, '').trim();
    // Extract all size-shaped tokens and pick the largest — net weight is always
    // the largest printed figure on the pack.
    const quantity = largestSize(cleaned);
    return { quantity, price: '' };
}

/**
 * Label structuring: turn clean OCR text into product identity fields using a
 * small local LLM (qwen2.5:1.5b via Ollama). This replaces the brittle
 * font-size/regex heuristics in parseLabel for the genuinely ambiguous call —
 * "is SWING a brand or a product name?" — which rules can't make but a model
 * with world knowledge can.
 *
 * Scope is deliberately narrow: brand / name / flavor only. Quantity, price and
 * back-panel detection stay with parseLabel's deterministic regex (an LLM could
 * hallucinate a price; regex cannot). Fail-soft: returns null if the model is
 * unavailable, and the caller keeps parseLabel's values.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// 1.5b (Q4_K_M, ~1.1 GB) is the proven sub-2B winner for structured JSON and
// fits the GPU left over by PaddleOCR-VL-1.6 (~1.9 GB). Ollama auto-offloads any
// overflow layers to CPU at load time, so it degrades to "a bit slower" rather
// than OOM if the desktop is using the card. num_ctx is capped low (below) to
// keep the KV cache tiny. Override via env for a different model. This is the
// LOCAL fallback; Groq (below) is primary when a key is set.
const MODEL = process.env.OLLAMA_STRUCT_MODEL || 'qwen2.5:1.5b';
const ENABLED = process.env.LABEL_LLM_ENABLED !== 'false';

// Primary structurer: Groq (free tier, OpenAI-compatible, ~10ms on an LPU).
// Llama-3.3-70b crushes brand/name disambiguation vs a local 1.5b and costs no
// GPU. Free tier renews daily (no finite credit pool) so it won't permanently
// dry up. Empty key -> skip straight to the local Ollama fallback.
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// True when Groq is the active primary. The caller uses this to decide whether
// to structure even a "confident" parse: the old 0.5b/1.5b local model swapped
// brand/name so the regex was trusted on clear matches, but the 70B doesn't, so
// it should run everywhere. Without a key we keep the conservative gate.
export const GROQ_ENABLED = ENABLED && !!GROQ_API_KEY;

// Generic product-type words the model may legitimately INFER as a name even
// when not printed (a SWING front shows only brand+flavor, the type is "Juice").
// Anything outside this set must be on the label, which blocks fabrications like
// "Foggy Juice". Single words; multi-word names are checked word-by-word.
const TYPE_WORDS = new Set([
    'juice', 'drink', 'water', 'soda', 'milk', 'curd', 'yogurt', 'yoghurt', 'lassi',
    'butter', 'cheese', 'paneer', 'ghee', 'cream', 'biscuit', 'biscuits', 'cookie',
    'cookies', 'wafer', 'wafers', 'chips', 'namkeen', 'snack', 'snacks', 'chocolate',
    'candy', 'muesli', 'oats', 'cereal', 'flakes', 'granola', 'noodles', 'pasta',
    'rice', 'flour', 'atta', 'sugar', 'salt', 'tea', 'coffee', 'sauce', 'ketchup',
    'jam', 'honey', 'spread', 'pickle', 'masala', 'spray', 'deodorant', 'deo',
    'perfume', 'fragrance', 'powder', 'talc', 'talcum', 'soap', 'shampoo',
    'conditioner', 'lotion', 'oil', 'gel', 'wash', 'scrub', 'toothpaste', 'paste',
    'sanitizer', 'sanitiser', 'handwash', 'detergent', 'cleaner', 'freshener',
    'bar', 'cake', 'bread', 'roll', 'spray', 'mist', 'serum', 'moisturiser',
    'moisturizer', 'sunscreen', 'body', 'face', 'hair', 'hand',
]);

let lastProbe = { at: 0, ok: false };
async function reachable(): Promise<boolean> {
    if (!ENABLED) return false;
    if (Date.now() - lastProbe.at < 30_000) return lastProbe.ok;
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        lastProbe = { at: Date.now(), ok: res.ok };
    } catch {
        lastProbe = { at: Date.now(), ok: false };
    }
    return lastProbe.ok;
}

const SYSTEM = `You label a grocery product from the raw OCR text of its package.
Output ONLY compact JSON, nothing else: {"brand":"","name":"","flavor":""}
- brand = the manufacturer / brand (e.g. Storia, Swing, Amul, Pond's).
- name  = the product type (e.g. Juice, Biscuit, Shampoo, Toothpaste). If only a brand and flavor are printed, infer the obvious product type.
- flavor = the variant / flavor / scent (e.g. Zesty Pomegranate, Mango, Pink Lily). Empty if none.
Use only words present in the text for brand and flavor. Ignore marketing claims (NO ADDED SUGAR, 100% NATURAL), sizes, prices and nutrition. If unsure, use an empty string.`;

export interface LabelFields {
    brand: string;
    name: string;
    flavor: string;
}

const USER_MSG = (text: string) => `OCR text:\n${text}\n\nReturn the JSON.`;

// Groq: OpenAI-compatible chat. Returns the raw assistant content or null.
async function groqContent(text: string): Promise<string | null> {
    if (!GROQ_API_KEY) return null;
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
            body: JSON.stringify({
                model: GROQ_MODEL,
                response_format: { type: 'json_object' },
                temperature: 0,
                // gpt-oss is a reasoning model: it spends tokens on a hidden
                // reasoning channel, so a tight 120 budget returns empty JSON
                // (json_validate_failed). Give headroom + cap reasoning to "low".
                // Harmless for non-reasoning models (llama stops early, ignores it).
                max_tokens: 512,
                ...(GROQ_MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: USER_MSG(text) },
                ],
            }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        return typeof raw === 'string' ? raw : null;
    } catch {
        return null;
    }
}

// Local Ollama fallback (only when reachable, since it's a self-hosted probe).
async function ollamaContent(text: string): Promise<string | null> {
    if (!(await reachable())) return null;
    try {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                format: 'json',
                stream: false,
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: USER_MSG(text) },
                ],
                options: { temperature: 0, num_predict: 120, num_ctx: 2048 },
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.message?.content;
        return typeof raw === 'string' ? raw : null;
    } catch {
        return null;
    }
}

export async function structureLabel(text: string): Promise<LabelFields | null> {
    if (!text.trim() || !ENABLED) return null;
    try {
        const raw = (await groqContent(text)) ?? (await ollamaContent(text));
        if (!raw) return null;
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const obj = JSON.parse(match[0]);
        const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
        // Anti-hallucination: brand and flavor MUST be printed on the label, so
        // drop any value whose words aren't in the OCR text (the 0.5b invents
        // brands like "Swing" / flavors like "Olive Oil" not on the pack).
        const norm = (v: string) => ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
        const hay = norm(text);
        const grounded = (v: string) => {
            const words = norm(v).trim().split(' ').filter((w) => w.length >= 2);
            return words.length && words.every((w) => hay.includes(w)) ? v : '';
        };
        // NAME may infer a product TYPE the label only implies ("Juice" for a
        // SWING front), so a name word is allowed if it's on the label OR a known
        // generic product type. This blocks fabrication ("Foggy Juice" from
        // "PARADISE FOGG") while keeping legitimate type inference.
        const groundedName = (v: string) => {
            const words = norm(v).trim().split(' ').filter((w) => w.length >= 2);
            return words.length && words.every((w) => hay.includes(w) || TYPE_WORDS.has(w)) ? v : '';
        };
        const fields = { brand: grounded(s(obj.brand)), name: groundedName(s(obj.name)), flavor: grounded(s(obj.flavor)) };
        // Need at least a brand or a name to be worth using.
        return fields.brand || fields.name ? fields : null;
    } catch {
        return null;
    }
}

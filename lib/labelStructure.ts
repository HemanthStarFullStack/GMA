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
// 0.5b keeps the GPU roomy next to PaddleOCR-VL (~640 MB free vs ~88 MB with
// the 1.5b) and still resolves brand/name fast. The 1.5b is slightly better at
// inferring a product type on bare brand+flavor labels — bump this env to it if
// you free up VRAM.
const MODEL = process.env.OLLAMA_STRUCT_MODEL || 'qwen2.5:0.5b';
const ENABLED = process.env.LABEL_LLM_ENABLED !== 'false';

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

export async function structureLabel(text: string): Promise<LabelFields | null> {
    if (!text.trim() || !(await reachable())) return null;
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
                    { role: 'user', content: `OCR text:\n${text}\n\nReturn the JSON.` },
                ],
                options: { temperature: 0, num_predict: 120, num_ctx: 2048 },
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.message?.content;
        if (typeof raw !== 'string') return null;
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

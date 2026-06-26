/**
 * Label structuring: turn OCR text into a full product identity using an LLM
 * (Groq gpt-oss-120b primary, local Ollama fallback). Replaces the brittle
 * font-size/regex heuristics for the genuinely ambiguous calls — "is SWING a
 * brand or a name?", "is 50 g EXTRA the size?" — which a model with world
 * knowledge makes far better than rules (verified on scripts/scan-eval.*).
 *
 * Returns brand/name/flavor/size/price/category/pack_count/panel + per-field
 * confidence. Fail-soft: returns null if no model is available, and the caller
 * keeps parseLabel's deterministic regex values.
 */
import { normalizeCategory } from './gemini';

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

// Full-contract structurer prompt. Validated against 35 real scans (scripts/
// scan-eval.*): with the 120B it lifted category 0%→~97% and held brand/name at
// ~86% while adding size/price/pack_count/panel + per-field confidence. The few-
// shot encodes the exact traps that bit us (50 g EXTRA promo, marketing hero
// lines, back-panel composition, "Marketed by" company != brand).
const SYSTEM = `You extract a structured product identity from the OCR text of an Indian grocery package. The text may be grouped into zones: PROMINENT (largest type), SECONDARY (medium), SMALL_PRINT (fine print), and a PANEL marker (front|back). If it is not grouped, work from the raw text.

Return ONLY this JSON, nothing else:
{"brand":{"value":"","confidence":"high|medium|low"},"name":{"value":"","confidence":"..."},"flavor":{"value":"","confidence":"..."},"size":{"value":"","confidence":"..."},"price":{"value":"","confidence":"..."},"pack_count":1,"category":"","panel":"front|back"}

Field rules:
- brand = manufacturer/brand from the most PROMINENT text (Pond's, Saffola, Storia, Fogg). Use only words present in the text.
- name = the product TYPE only, SHORT (1-3 words), e.g. "Talcum Powder","Oats","Juice","Body Spray","Face Wash","Biscuit","Muesli","Cream","Mineral Water". NEVER a tagline, slogan or hero line ("From the French Alps","The Taste of Wellness") — those are marketing, not the name. You MAY infer the obvious type even if not printed verbatim.
- flavor = variant/scent/sub-line (Pink Lily, Pomegranate, Cool Herbal, Paradise, Dark Chocolate + Cranberry). "" if none. Use only printed words.
- size = the declared NET quantity ONLY, normalized "500 g","1 L","250 ml". "" if not clearly printed. NEVER a promo ("50 g EXTRA","9g Extra"), per-serving, or nutrition number.
- price = MRP only as "₹<n>". "" if not printed.
- pack_count = number of units in a multipack, else 1.
- category = EXACTLY ONE of: "Dairy & Eggs","Beverages","Fruits & Vegetables","Meat & Seafood","Bakery","Pantry","Frozen Foods","Snacks","Condiments & Sauces","Cleaning & Household","Personal Care","Other".
- panel = front or back. A back/nutrition/ingredients/legal panel: ALWAYS return brand:"" and name:"" (the brand lives on the front; a "Marketed by / Manufactured by" company in fine print is NOT the brand). Still extract size/price/category from it.
- category mapping: Biscuits, cookies, wafers, chips, chocolate, namkeen -> "Snacks" (NOT Bakery; Bakery = fresh bread/buns/cakes only). Juice/soda/water/tea/coffee -> "Beverages". Talc/soap/shampoo/cream/face wash/deodorant/body spray -> "Personal Care". Rice/flour/oats/muesli/cereal/oil/sugar/salt/spices/noodles -> "Pantry".

Hard rules:
- PREFER EMPTY OVER GUESSING. If an attribute is not clearly on the label, or you are not confident, return value:"" with confidence:"low". Never fill a field with a plausible-but-unverified guess (don't invent a size, a flavor, or a product type you can't justify from the text). A blank field is better than a wrong one.
- Mark confidence "low" whenever you infer, are unsure, or the OCR text is garbled — those values will be discarded, so only put "high"/"medium" on values you can actually see in the text.
- category: if you cannot confidently classify it, use "Other" rather than picking a plausible-looking wrong category.
- IGNORE marketing ("100% NATURAL","#1 BRAND","NEW PACK","NO ADDED SUGAR","FREE"), addresses, batch, dates, FSSAI, "Marketed by"/"Manufactured by" company names.
- "50 g EXTRA","20% MORE","9g Extra","FREE 60 g" are PROMOS - never brand, never size.

Examples (input -> output):
PROMINENT: POND'S | SECONDARY: DREAMFLOWER, fragrant talcum powder, PINK LILY | SMALL_PRINT: 50 g EXTRA | PANEL: front
-> {"brand":{"value":"Pond's","confidence":"high"},"name":{"value":"Talcum Powder","confidence":"high"},"flavor":{"value":"Pink Lily","confidence":"high"},"size":{"value":"","confidence":"low"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Personal Care","panel":"front"}
PROMINENT: Saffola, Oats | SECONDARY: Creamy Oats | SMALL_PRINT: India's #1 Oats Brand, 100% Natural | PANEL: front
-> {"brand":{"value":"Saffola","confidence":"high"},"name":{"value":"Oats","confidence":"high"},"flavor":{"value":"Creamy","confidence":"medium"},"size":{"value":"","confidence":"low"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Pantry","panel":"front"}
PROMINENT: evian | SECONDARY: Natural Mineral Water | SMALL_PRINT: From the French Alps, Des Alpes Françaises | PANEL: front
-> {"brand":{"value":"evian","confidence":"high"},"name":{"value":"Mineral Water","confidence":"high"},"flavor":{"value":"","confidence":"low"},"size":{"value":"","confidence":"low"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Beverages","panel":"front"}
PROMINENT: nycil | SECONDARY: GERM EXPERT, Cool Herbal, PRICKLY HEAT POWDER | SMALL_PRINT: FREE 60 g, Rs.75 | PANEL: front
-> {"brand":{"value":"Nycil","confidence":"high"},"name":{"value":"Prickly Heat Powder","confidence":"high"},"flavor":{"value":"Cool Herbal","confidence":"high"},"size":{"value":"","confidence":"low"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Personal Care","panel":"front"}
SMALL_PRINT: COMPOSITION ... Marico ... Net Qty 39 g ... NUTRITIONAL INFORMATION ... | PANEL: back
-> {"brand":{"value":"","confidence":"low"},"name":{"value":"","confidence":"low"},"flavor":{"value":"","confidence":"low"},"size":{"value":"39 g","confidence":"high"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Pantry","panel":"back"}`;

export type Confidence = 'high' | 'medium' | 'low';
export interface LabelFields {
    brand: string;
    name: string;
    flavor: string;
    size: string;
    price: string;
    category: string;
    packCount: number;
    panel: 'front' | 'back';
    confidence: { brand: Confidence; name: Confidence; flavor: Confidence; size: Confidence };
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
                // reasoning channel, so a tight budget returns empty JSON
                // (json_validate_failed). 700 covers reasoning + the richer
                // multi-field object. Cap reasoning to "low". Harmless for
                // non-reasoning models (llama stops early, ignores it).
                max_tokens: 700,
                ...(GROQ_MODEL.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
                messages: [
                    { role: 'system', content: SYSTEM },
                    { role: 'user', content: USER_MSG(text) },
                ],
            }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
            // Surface, don't swallow: a dead key (401) or rate-limit (429) was
            // invisible for days. One line in the logs makes it obvious.
            console.warn(`[structurer] Groq ${GROQ_MODEL} HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
            return null;
        }
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        return typeof raw === 'string' ? raw : null;
    } catch (e) {
        console.warn(`[structurer] Groq request failed: ${(e as Error).message}`);
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
                options: { temperature: 0, num_predict: 512, num_ctx: 2048 },
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
            console.warn(`[structurer] Ollama ${MODEL} HTTP ${res.status}`);
            return null;
        }
        const data = await res.json();
        const raw = data?.message?.content;
        return typeof raw === 'string' ? raw : null;
    } catch (e) {
        console.warn(`[structurer] Ollama request failed: ${(e as Error).message}`);
        return null;
    }
}

export async function structureLabel(text: string): Promise<LabelFields | null> {
    if (!text.trim() || !ENABLED) return null;
    try {
        const raw = (await groqContent(text)) ?? (await ollamaContent(text));
        if (!raw) {
            console.warn('[structurer] no structurer available (Groq + Ollama both failed) — falling back to regex parse');
            return null;
        }
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const obj = JSON.parse(match[0]);

        // Each field may be {value,confidence} (new contract) or a bare string
        // (be liberal in what we accept). Pull both shapes.
        const asObj = (f: unknown): Record<string, unknown> | null =>
            f && typeof f === 'object' ? (f as Record<string, unknown>) : null;
        const val = (f: unknown): string => {
            const o = asObj(f);
            if (o) return String(o.value ?? '').trim();
            return typeof f === 'string' ? f.trim() : '';
        };
        const conf = (f: unknown): Confidence => {
            const c = asObj(f)?.confidence;
            return c === 'high' || c === 'low' ? c : 'medium';
        };

        // Grounding is now WARN, not DELETE: with the 120B hallucination is rare,
        // and hard-dropping cost recall whenever OCR garbled a letter. So we keep
        // the model's value but downgrade confidence to 'low' when its words
        // aren't in the OCR text — the UI flags low-confidence fields for review.
        const norm = (v: string) => ` ${v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
        const hay = norm(text);
        const isGrounded = (v: string, allowType = false) => {
            const words = norm(v).trim().split(' ').filter((w) => w.length >= 2);
            return words.length > 0 && words.every((w) => hay.includes(w) || (allowType && TYPE_WORDS.has(w)));
        };
        const downgradeIfUngrounded = (v: string, c: Confidence, allowType = false): Confidence =>
            v && !isGrounded(v, allowType) ? 'low' : c;

        let brand = val(obj.brand);
        let name = val(obj.name);
        const flavor = val(obj.flavor);
        const size = val(obj.size);
        const price = val(obj.price);
        const panel: 'front' | 'back' = obj.panel === 'back' ? 'back' : 'front';

        // Back panel: identity is never reliable here (it's nutrition/legal text).
        // Force it empty so a "Marketed by Marico" never becomes the brand.
        if (panel === 'back') { brand = ''; name = ''; }

        // Final per-field confidence: the model's own, downgraded to 'low' when
        // the value isn't grounded in the OCR text.
        const cBrand = downgradeIfUngrounded(brand, conf(obj.brand));
        // A product TYPE is short (1-4 words). A long "name" is the model grabbing
        // a tagline/hero line ("From the French Alps...") — reject it (→ blanked).
        const isTypeName = (v: string) => {
            const words = v.trim().split(/\s+/).filter(Boolean);
            return words.length >= 1 && words.length <= 4 && v.length <= 32;
        };
        let cName = downgradeIfUngrounded(name, conf(obj.name), true);
        if (name && !isTypeName(name)) cName = 'low';
        const cFlavor = downgradeIfUngrounded(flavor, conf(obj.flavor));
        const cSize = conf(obj.size);
        const cPrice = conf(obj.price);

        // Conservative fill: NEVER surface a value the model isn't sure of. If a
        // field's final confidence is 'low' (self-reported OR ungrounded), leave
        // it EMPTY — an empty field the user fills beats a confident-looking wrong
        // guess. Only high/medium values pass through.
        const sure = (v: string, c: Confidence) => (c === 'low' ? '' : v);

        const fields: LabelFields = {
            brand: sure(brand, cBrand),
            name: sure(name, cName),
            flavor: sure(flavor, cFlavor),
            size: sure(size, cSize),
            price: sure(price, cPrice),
            category: normalizeCategory(obj.category),
            packCount: Number.isFinite(obj.pack_count) && obj.pack_count > 0 ? Math.round(obj.pack_count) : 1,
            panel,
            confidence: { brand: cBrand, name: cName, flavor: cFlavor, size: cSize },
        };
        // Worth using if it produced any identity or a useful attribute.
        return fields.brand || fields.name || fields.size || fields.category !== 'Other' ? fields : null;
    } catch {
        return null;
    }
}

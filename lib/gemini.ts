// Read from the environment. If unset, prediction silently falls through to the
// local LLM tier and then the heuristic — the app never hard-fails on a missing key.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Try these in order. Each model has its OWN per-minute + per-day free-tier
// quota bucket, so when a burst of scans rate-limits the first model the
// request spills over to the next instead of falling back to a heuristic.
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];

// The single source of truth for product categories across the app.
export const CATEGORIES = [
    'Dairy & Eggs', 'Beverages', 'Fruits & Vegetables', 'Meat & Seafood',
    'Bakery', 'Pantry', 'Frozen Foods', 'Snacks', 'Condiments & Sauces',
    'Cleaning & Household', 'Personal Care', 'Other',
] as const;

export type ProductMeta = {
    averageDuration: number;
    category: string;
    predicted: boolean; // true if the AI produced it; false = heuristic fallback
};

type GeminiPrediction = {
    unitSize: string;
    servingsPerUnit: number;
    dailyUse: number;
    averageDuration: number;
    category: string;
    confidence: 'high' | 'medium' | 'low';
};

const SYSTEM_INSTRUCTION = `You are a household grocery analyst. For ONE purchased unit of a product, reason step by step BEFORE answering, and put each step in the JSON.

Answer these questions in order:
1. unitSize — the net quantity of ONE unit as a string: volume, weight, or count (e.g. "1.2 L", "26 g", "pack of 6"). If the size is missing, infer the most common retail size for that product.
2. servingsPerUnit — how many servings/uses that quantity contains for one person.
3. dailyUse — how many of those servings one person consumes per day (may be fractional).
4. averageDuration — servingsPerUnit / dailyUse, rounded to a WHOLE number of days, minimum 1. Never fractions.
5. category — EXACTLY ONE string from the fixed list below (copy verbatim).

SIZE MATTERS — scale the duration with the quantity. Reference daily-use rates for one person:
- Soft drinks / juice ~0.5 L/day -> 330 ml can = 1, 500-600 ml = 2, 1 L = 2, 1.2 L = 3, 1.5 L = 3, 2 L = 4, 2.25 L = 5.
- Milk ~0.3 L/day -> 500 ml = 2, 1 L = 3, 2 L = 6.
- Cooking oil ~30 ml/day -> 500 ml = 15, 1 L = 30, 5 L = 90.
- Rice/flour/grains ~0.15 kg/day -> 1 kg = 7, 5 kg = 34, 10 kg = 45.
- Snacks: single packet <60 g = 1; sharing pack 100-200 g = 2-3.
- Toothpaste 100 g = 30, 200 g = 60. Detergent powder 1 kg = 30.
- Anything finished in one sitting (single chocolate, one chips packet, one noodle packet) = 1.

Category list (copy one verbatim): "Dairy & Eggs", "Beverages", "Fruits & Vegetables", "Meat & Seafood", "Bakery", "Pantry", "Frozen Foods", "Snacks", "Condiments & Sauces", "Cleaning & Household", "Personal Care", "Other".
- Rice, flour, lentils, oil, sugar, salt, spices, pasta, instant noodles -> "Pantry".
- Chips, biscuits, chocolate, namkeen -> "Snacks". Tea, coffee, juice, soda, water -> "Beverages".
- Soap, detergent, cleaners, tissue -> "Cleaning & Household". Toothpaste, shampoo, skincare -> "Personal Care".
- If genuinely unclear, use "Other".

Return ONLY valid JSON, no text outside it, with keys: unitSize, servingsPerUnit, dailyUse, averageDuration, category, confidence.`;

const FEW_SHOT_EXAMPLES = [
    {
        product: 'Sprite Lime Soft Drink, Sprite, 1.2 litre bottle',
        response: { unitSize: '1.2 L', servingsPerUnit: 5, dailyUse: 1.7, averageDuration: 3, category: 'Beverages', confidence: 'high' },
    },
    {
        product: 'Coca-Cola, 2 litre bottle',
        response: { unitSize: '2 L', servingsPerUnit: 8, dailyUse: 2, averageDuration: 4, category: 'Beverages', confidence: 'high' },
    },
    {
        product: 'Lays Classic Salted Chips, 26 g packet',
        response: { unitSize: '26 g', servingsPerUnit: 1, dailyUse: 1, averageDuration: 1, category: 'Snacks', confidence: 'high' },
    },
    {
        product: 'Amul Toned Milk, 1 litre carton',
        response: { unitSize: '1 L', servingsPerUnit: 4, dailyUse: 1.3, averageDuration: 3, category: 'Dairy & Eggs', confidence: 'high' },
    },
    {
        product: 'Aashirvaad Atta Whole Wheat Flour, 10 kg bag',
        response: { unitSize: '10 kg', servingsPerUnit: 66, dailyUse: 1.5, averageDuration: 45, category: 'Pantry', confidence: 'medium' },
    },
    {
        product: 'Colgate Strong Teeth Toothpaste, 200 g tube',
        response: { unitSize: '200 g', servingsPerUnit: 120, dailyUse: 2, averageDuration: 60, category: 'Personal Care', confidence: 'high' },
    },
    {
        product: 'Maggi 2-Minute Noodles, 70 g packet',
        response: { unitSize: '70 g', servingsPerUnit: 1, dailyUse: 1, averageDuration: 1, category: 'Pantry', confidence: 'high' },
    },
];

function buildPrompt(name: string, brand: string, category: string, unit: string): string {
    const examples = FEW_SHOT_EXAMPLES.map(
        (e) => `Product: ${e.product}\nJSON: ${JSON.stringify(e.response)}`,
    ).join('\n\n');

    const productLine = [name, brand, category, unit].filter(Boolean).join(', ');

    return `${examples}

Product: ${productLine}
JSON:`;
}

export function normalizeCategory(raw?: string | null): string {
    if (!raw) return 'Other';
    const exact = CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
    if (exact) return exact;
    // Loose match on the first word ("Snacks" in "Snacks & Treats", etc.)
    const lower = raw.toLowerCase();
    return CATEGORIES.find((c) => lower.includes(c.toLowerCase().split(' ')[0])) || 'Other';
}

/**
 * Ask Gemini for both the consumption duration and the category in one call.
 * `categoryHint` is whatever the barcode databases guessed — used as a fallback
 * if the model fails. Falls back to { 14, hint||Other } on any error.
 */
export async function predictProductMeta(
    name: string,
    brand: string,
    categoryHint: string,
    unit: string,
): Promise<ProductMeta> {
    const fallback: ProductMeta = { averageDuration: 14, category: normalizeCategory(categoryHint), predicted: false };
    if (!GEMINI_API_KEY) return fallback;

    const body = {
        system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(name, brand, categoryHint, unit) }] }],
        generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1,
            // Generous cap so longer reasoning (e.g. bulk multipacks) can't
            // truncate the JSON mid-object and force a fallback.
            maxOutputTokens: 512,
            // Disable extended thinking — it adds prose before the JSON and
            // blows past the JSON-mode contract on gemini-2.5-flash.
            thinkingConfig: { thinkingBudget: 0 },
        },
    };

    // Walk the model list. A 429/timeout on one model immediately tries the
    // next (separate quota bucket) rather than failing to a heuristic.
    for (const model of GEMINI_MODELS) {
        try {
            const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(9000),
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.warn(`Gemini [${model}] failed: ${res.status} ${errText.slice(0, 100)}`);
                continue; // spill over to the next model
            }

            const data = await res.json();
            const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
            // Extract JSON even if the model wraps it in prose or a code fence.
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn(`Gemini [${model}] returned no JSON:`, rawText.slice(0, 100));
                continue;
            }
            const parsed: GeminiPrediction = JSON.parse(jsonMatch[0]);

            const days = Math.max(1, Math.round(parsed.averageDuration));
            const category = normalizeCategory(parsed.category) || fallback.category;
            const averageDuration = Number.isFinite(days) ? days : 14;

            console.log(
                `Gemini: ${averageDuration}d · ${category} for "${name}" [${parsed.unitSize} · ${parsed.servingsPerUnit}/${parsed.dailyUse}/day · ${parsed.confidence}]`,
            );
            return { averageDuration, category, predicted: true };
        } catch (err) {
            console.warn(`Gemini [${model}] error:`, err);
        }
    }

    // Tier 2: local Ollama model (with web_search) — only when Gemini is down /
    // rate-limited. Skipped instantly if Ollama isn't running.
    console.warn(`Gemini failed on all models (${GEMINI_MODELS.join(', ')}) for "${name}" — trying local LLM`);
    try {
        const { predictWithLocalLlm } = await import('./localLlm');
        const local = await predictWithLocalLlm(name, brand, categoryHint, unit);
        if (local) return local;
    } catch (err) {
        console.warn('Local LLM tier error:', err);
    }

    console.warn(`All predictors failed for "${name}" — using heuristic fallback ${JSON.stringify(fallback)}`);
    return fallback;
}

/** Back-compat: duration only (used by the refresh-durations admin endpoint). */
export async function predictConsumptionDays(
    name: string,
    brand: string,
    category: string,
    unit: string,
): Promise<number> {
    const meta = await predictProductMeta(name, brand, category, unit);
    return meta.averageDuration;
}

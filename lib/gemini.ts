const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

type GeminiPrediction = {
    averageDuration: number;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
};

const SYSTEM_INSTRUCTION = `You are a household grocery consumption analyst.
Your job is to predict how many whole days ONE person takes to consume ONE purchased unit of a grocery product under normal daily-life usage patterns.

Rules:
- Return a WHOLE NUMBER (integer) of days, minimum 1. Never return fractions or decimals.
- Anything finished in one sitting or within the same day = 1.
- A single-serve snack (chips packet, biscuit packet, candy bar) = 1 day.
- A 1L milk carton = 3 days.
- A 10kg flour bag = 45 days.
- A 200g toothpaste tube = 60 days.
- Soft drinks 1L = 2 days. Soft drinks 2L = 4 days.
- Cooking oil 1L = 30 days. Cooking oil 5L = 90 days.
- Instant noodle packet = 1 day.
- Return ONLY valid JSON. No text outside the JSON object.`;

const FEW_SHOT_EXAMPLES = [
    {
        product: 'Lays Classic Salted Chips, Snacks, 26g packet',
        response: { averageDuration: 1, confidence: 'high', reasoning: 'Single-serve snack packet consumed in one sitting.' },
    },
    {
        product: 'Amul Toned Milk, Dairy & Eggs, 1 litre carton',
        response: { averageDuration: 3, confidence: 'high', reasoning: '1L milk is used over 2-4 days for daily tea, coffee, or cereal.' },
    },
    {
        product: 'Aashirvaad Atta Whole Wheat Flour, Pantry, 10 kg bag',
        response: { averageDuration: 45, confidence: 'medium', reasoning: '10kg flour lasts a single person roughly 6-7 weeks of daily cooking.' },
    },
    {
        product: 'Colgate Strong Teeth Toothpaste, Personal Care, 200g tube',
        response: { averageDuration: 60, confidence: 'high', reasoning: 'A 200g toothpaste tube typically lasts one person about 2 months.' },
    },
    {
        product: 'Maggi 2-Minute Noodles, Pantry, 70g packet',
        response: { averageDuration: 1, confidence: 'high', reasoning: 'A single Maggi packet is one meal — consumed immediately.' },
    },
    {
        product: 'Fortune Sunflower Oil, Pantry, 1 litre bottle',
        response: { averageDuration: 30, confidence: 'medium', reasoning: '1L cooking oil is used across daily meals and lasts about a month.' },
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

export async function predictConsumptionDays(
    name: string,
    brand: string,
    category: string,
    unit: string,
): Promise<number> {
    if (!GEMINI_API_KEY) return 14;

    try {
        const body = {
            system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: [{ text: buildPrompt(name, brand, category, unit) }] }],
            generationConfig: {
                response_mime_type: 'application/json',
                temperature: 0.1,
                maxOutputTokens: 256,
                // Disable extended thinking — it adds prose before the JSON and
                // blows past the JSON-mode contract on gemini-2.5-flash.
                thinkingConfig: { thinkingBudget: 0 },
            },
        };

        const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn(`Gemini prediction failed: ${res.status} ${errText}`);
            return 14;
        }

        const data = await res.json();
        const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        // Extract JSON even if the model wraps it in prose or a code fence.
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('Gemini returned no JSON:', rawText.slice(0, 100));
            return 14;
        }
        const parsed: GeminiPrediction = JSON.parse(jsonMatch[0]);

        const days = Math.max(1, Math.round(parsed.averageDuration));
        if (!Number.isFinite(days)) return 14;

        console.log(
            `Gemini predicted ${days}d for "${name}" (${parsed.confidence}) — ${parsed.reasoning}`,
        );
        return days;
    } catch (err) {
        console.warn('Gemini consumption prediction error:', err);
        return 14;
    }
}

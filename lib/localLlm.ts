import { CATEGORIES, normalizeCategory, type ProductMeta, type PredictContext } from './gemini';

/**
 * Tier-2 backup predictor: a local Ollama model with a web_search tool.
 *
 * Only invoked when the primary (Gemini) is rate-limited or unavailable, so it
 * is intentionally lazy: nothing is loaded until a call happens, the model is
 * unloaded from VRAM immediately after (keep_alive: 0), and if Ollama is not
 * running the whole tier is skipped (returns null) without error.
 */

// Configurable so the model can live on the host, another container, or a remote
// box. In Docker, point this at http://host.docker.internal:11434 (host Ollama).
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b'; // light enough for a 4GB GPU; tool-calling capable
const ENABLED = process.env.LOCAL_LLM_ENABLED !== 'false'; // opt-out switch

// ── Reachability ─────────────────────────────────────────────────────────────
// Cheap probe so a missing/stopped Ollama never blocks a scan for long.
let lastProbe = { at: 0, ok: false };
async function ollamaReachable(): Promise<boolean> {
    if (!ENABLED) return false;
    if (Date.now() - lastProbe.at < 30_000) return lastProbe.ok; // cache 30s
    try {
        const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        lastProbe = { at: Date.now(), ok: res.ok };
    } catch {
        lastProbe = { at: Date.now(), ok: false };
    }
    return lastProbe.ok;
}

// ── web_search tool (DuckDuckGo, no API key) ─────────────────────────────────
function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

async function webSearch(query: string): Promise<string> {
    try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (GMA grocery app)' },
            signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return 'No results.';
        const html = await res.text();
        const snippets = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
            .map((m) => stripTags(m[1]))
            .filter(Boolean)
            .slice(0, 3);
        return snippets.length ? snippets.join(' | ') : 'No results.';
    } catch {
        return 'Search failed.';
    }
}

const TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for facts about an unfamiliar grocery product (its typical pack size, what it is, how it is consumed). Use only if you are unsure what the product is.',
            parameters: {
                type: 'object',
                properties: { query: { type: 'string', description: 'A concise search query.' } },
                required: ['query'],
            },
        },
    },
];

const SYSTEM = `You estimate grocery consumption FOR ONE PERSON. For ONE unit of a product output STRICT JSON:
{"averageDuration": <whole number of days ONE person takes to finish one unit, min 1>, "category": <one of the list>, "unitSize": "<net size>"}
Scale duration by pack size (per-person rates): soft drink ~0.5 L/day (330ml=1, 1L=2, 1.2L=3, 2L=4); milk ~0.3 L/day (1L=3); rice/flour ~0.15 kg/day (5kg=34); oil 1L=30; deodorant/body spray 150ml=45; perfume 100ml=120; single snack packet=1; toothpaste 200g=60.
Personal-care durables (sprays, perfumes, lotions) last weeks/months, never 1 day. Answer for ONE person only — the app scales for household size separately.
category MUST be exactly one of: ${CATEGORIES.join(', ')}.
If you do not recognise the product, call web_search first, then answer. Output ONLY the JSON object, nothing else.`;

type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
};

async function chat(messages: ChatMessage[], withTools: boolean): Promise<ChatMessage | null> {
    try {
        const res = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                messages,
                ...(withTools ? { tools: TOOLS } : { format: 'json' }),
                stream: false,
                keep_alive: 0, // unload from VRAM immediately after this call
                options: {
                    temperature: 0.1,
                    num_predict: 300,
                    // Cap context to what this task needs. Llama 3.2's default
                    // 128K window makes Ollama allocate a ~20GB KV cache that
                    // spills to CPU; 2K keeps the whole model GPU-resident.
                    num_ctx: 2048,
                },
            }),
            signal: AbortSignal.timeout(60_000), // first call cold-loads the model
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.message ?? null;
    } catch {
        return null;
    }
}

export async function predictWithLocalLlm(
    name: string,
    brand: string,
    categoryHint: string,
    unit: string,
    extra?: PredictContext,
): Promise<ProductMeta | null> {
    if (!(await ollamaReachable())) return null;

    const parts: string[] = [name, brand].filter(Boolean);
    const size = (extra?.size || unit || '').trim();
    if (size && size.toLowerCase() !== 'units') parts.push(size);
    if (extra?.flavor) parts.push(`${extra.flavor} variant`);
    if (extra?.price !== undefined && extra?.price !== '' && extra?.price !== null) parts.push(`approx price ${extra.price}`);
    if (categoryHint) parts.push(categoryHint);
    const productLine = parts.join(', ');

    const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Product: ${productLine}\nReturn the JSON (for one person).` },
    ];

    // Up to 2 tool rounds, then a forced JSON finalisation.
    for (let round = 0; round < 2; round++) {
        const msg = await chat(messages, true);
        if (!msg) return null;
        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });

        if (msg.tool_calls?.length) {
            for (const tc of msg.tool_calls) {
                if (tc.function?.name === 'web_search') {
                    const q = String(tc.function.arguments?.query ?? `${name} ${brand} ${unit}`);
                    const result = await webSearch(q);
                    messages.push({ role: 'tool', content: result });
                }
            }
            continue; // let the model use the results
        }

        const parsed = parseMeta(msg.content, categoryHint);
        if (parsed) { console.log(`LocalLLM(${MODEL}): ${parsed.averageDuration}d · ${parsed.category} for "${name}"`); return parsed; }
        break;
    }

    // Final pass: no tools, forced JSON.
    const finalMsg = await chat([...messages, { role: 'user', content: 'Now output ONLY the JSON object.' }], false);
    const parsed = finalMsg ? parseMeta(finalMsg.content, categoryHint) : null;
    if (parsed) console.log(`LocalLLM(${MODEL}): ${parsed.averageDuration}d · ${parsed.category} for "${name}" (final)`);
    return parsed;
}

function parseMeta(raw: string | undefined, categoryHint: string): ProductMeta | null {
    if (!raw) return null;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const obj = JSON.parse(match[0]);
        const days = Math.max(1, Math.round(Number(obj.averageDuration)));
        if (!Number.isFinite(days)) return null;
        return {
            averageDuration: days,
            category: normalizeCategory(obj.category) || normalizeCategory(categoryHint),
            predicted: true,
        };
    } catch {
        return null;
    }
}

// Scan accuracy eval. Runs every labeled image through the real reader+structurer
// HTTP services and scores per-field accuracy vs scripts/scan-eval.json.
//
// Run inside the app container (has VISION_OCR_URL + GROQ_API_KEY + the images):
//   docker cp scripts/scan-eval.json gma-app:/tmp/ && docker cp scripts/scan-eval.mjs gma-app:/tmp/
//   docker exec gma-app node /tmp/scan-eval.mjs /app/public/uploads /tmp/scan-eval.json
//
// Swap the CONFIG block to A/B prompts, re-run, compare. Winners get ported to
// lib/visionOcr.ts (READER_PROMPT) and lib/labelStructure.ts (STRUCT_SYSTEM).
import fs from 'fs';

// ===================== CONFIG (the only thing you tune) =====================
const VLM = process.env.VISION_OCR_URL;
const GK = process.env.GROQ_API_KEY;
const GM = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GEMK = process.env.GEMINI_API_KEY;
// Reader can be the local Qwen VLM (default) or Gemini (EVAL_READER=gemini) — A/B
// which transcribes labels better. Gemini walks flash-lite→flash (separate quotas).
// flash first: it's the stronger OCR model, and prod's duration-predictor already
// burns the flash-lite quota — flash-lite stays as spillover only.
const GEM_READ_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

// --- which variant: "baseline" (current prod prompts) or "v2" (new zoned) ---
// Reader and structurer can be mixed independently to isolate which change helps.
const VARIANT = process.env.EVAL_VARIANT || 'baseline';
const READER_VARIANT = process.env.EVAL_READER || VARIANT;
const STRUCT_VARIANT = process.env.EVAL_STRUCT || VARIANT;

const READER_PROMPT = {
  baseline: 'Recognize all the text in the image.',
  v2: `Transcribe ALL text on this product package, grouped by how visually prominent each part is. Use exactly these labels, one per line:
PROMINENT: <the largest text — usually the brand logo and/or the hero product word>
SECONDARY: <medium text — product type, variant, sub-brand>
SMALL_PRINT: <fine print — net weight/volume, MRP, batch, nutrition, statutory>
PANEL: <front if this is the branded front face, back if it is a nutrition/ingredients/legal panel>
Copy text exactly as printed. Do not translate, guess, or add anything not on the package. Leave a group empty if nothing fits.`,
}[READER_VARIANT];

const STRUCT_SYSTEM = {
  baseline: `You label a grocery product from the raw OCR text of its package.
Output ONLY compact JSON, nothing else: {"brand":"","name":"","flavor":""}
- brand = the manufacturer / brand (e.g. Storia, Swing, Amul, Pond's).
- name  = the product type (e.g. Juice, Biscuit, Shampoo, Toothpaste). If only a brand and flavor are printed, infer the obvious product type.
- flavor = the variant / flavor / scent (e.g. Zesty Pomegranate, Mango, Pink Lily). Empty if none.
Use only words present in the text for brand and flavor. Ignore marketing claims (NO ADDED SUGAR, 100% NATURAL), sizes, prices and nutrition. If unsure, use an empty string.`,
  v2: `You extract a structured product identity from the OCR text of an Indian grocery package. The text may be grouped into zones: PROMINENT (largest type), SECONDARY (medium), SMALL_PRINT (fine print), and a PANEL marker (front|back).

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
- category: Biscuits, cookies, wafers, chips, chocolate, namkeen → "Snacks" (NOT Bakery; Bakery = fresh bread/buns/cakes only). Juice/soda/water/tea/coffee → "Beverages". Talc/soap/shampoo/cream/face wash/deodorant/body spray → "Personal Care". Rice/flour/oats/muesli/cereal/oil/sugar/salt/spices/noodles → "Pantry".

Hard rules:
- PREFER EMPTY OVER GUESSING. If an attribute is not clearly on the label, or you are not confident, return value:"" with confidence:"low". Never fill a field with a plausible-but-unverified guess (don't invent a size, a flavor, or a product type you can't justify from the text). A blank field is better than a wrong one.
- Mark confidence "low" whenever you infer, are unsure, or the OCR text is garbled — those values will be discarded, so only put "high"/"medium" on values you can actually see in the text.
- category: if you cannot confidently classify it, use "Other" rather than picking a plausible-looking wrong category.
- IGNORE marketing ("100% NATURAL","#1 BRAND","NEW PACK","NO ADDED SUGAR","FREE"), addresses, batch, dates, FSSAI, "Marketed by"/"Manufactured by" company names.
- "50 g EXTRA","20% MORE","9g Extra","FREE 60 g" are PROMOS — never brand, never size.

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
-> {"brand":{"value":"","confidence":"low"},"name":{"value":"","confidence":"low"},"flavor":{"value":"","confidence":"low"},"size":{"value":"39 g","confidence":"high"},"price":{"value":"","confidence":"low"},"pack_count":1,"category":"Pantry","panel":"back"}`,
}[STRUCT_VARIANT];

const GROUND_MODE = process.env.EVAL_GROUND || (STRUCT_VARIANT === 'baseline' ? 'drop' : 'warn'); // drop = delete ungrounded; warn = keep, lower confidence
// ===========================================================================

const TYPE_WORDS = new Set(['juice','drink','water','soda','milk','curd','yogurt','yoghurt','lassi','butter','cheese','paneer','ghee','cream','biscuit','biscuits','cookie','cookies','wafer','wafers','chips','namkeen','snack','snacks','chocolate','candy','muesli','oats','cereal','flakes','granola','noodles','pasta','rice','flour','atta','sugar','salt','tea','coffee','sauce','ketchup','jam','honey','spread','pickle','masala','spray','deodorant','deo','perfume','fragrance','powder','talc','talcum','soap','shampoo','conditioner','lotion','oil','gel','wash','scrub','toothpaste','paste','sanitizer','sanitiser','handwash','detergent','cleaner','freshener','bar','cake','bread','roll','mist','serum','moisturiser','moisturizer','sunscreen','body','face','hair','hand','heat']);
const norm = (v) => ` ${String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()} `;

async function vlmRead(b64) {
  const r = await fetch(`${VLM}/v1/chat/completions`, { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ model:'qwen3-vl', temperature:0, stream:false, max_tokens:1024,
      messages:[{role:'user',content:[{type:'text',text:READER_PROMPT},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${b64}`}}]}] }), signal: AbortSignal.timeout(75000) });
  if (!r.ok) return null;
  const d = await r.json();
  const t = d?.choices?.[0]?.message?.content;
  return typeof t === 'string' && t.trim() ? t.trim() : null;
}

// Gemini reader: same "transcribe everything" task as the local VLM, so the
// structurer + grounding downstream are unchanged — only the OCR source differs.
async function geminiRead(b64) {
  const body = {
    contents: [{ role: 'user', parts: [
      { text: READER_PROMPT || 'Recognize all the text in the image.' },
      { inline_data: { mime_type: 'image/jpeg', data: b64 } },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
  };
  for (const model of GEM_READ_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMK}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!r.ok) { if (r.status === 429) continue; return null; }
      const d = await r.json();
      const t = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof t === 'string' && t.trim()) return t.trim();
    } catch { /* spill to next model */ }
  }
  return null;
}

const readImage = (process.env.EVAL_READER === 'gemini') ? geminiRead : vlmRead;

async function structure(raw) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+GK},
    body: JSON.stringify({ model:GM, response_format:{type:'json_object'}, temperature:0, max_tokens:700,
      ...(GM.includes('gpt-oss')?{reasoning_effort:'low'}:{}),
      messages:[{role:'system',content:STRUCT_SYSTEM},{role:'user',content:`OCR text:\n${raw}\n\nReturn the JSON.`}] }) });
  if (!r.ok) return { _http: r.status };
  const d = await r.json();
  const c = d?.choices?.[0]?.message?.content;
  const m = c && c.match(/\{[\s\S]*\}/);
  if (!m) return { _nojson: true };
  try { return JSON.parse(m[0]); } catch { return { _badjson: true }; }
}

// read a field that may be a string or {value,confidence}
const val = (f) => (f && typeof f === 'object' ? f.value : f) || '';
const conf = (f) => { const c = f && typeof f === 'object' ? f.confidence : undefined; return (c === 'high' || c === 'low') ? c : 'medium'; };
// grounding: every word of v present in hay?
const grounded = (v, hay, allowType=false) => {
  const w = norm(v).trim().split(' ').filter(x => x.length >= 2);
  return w.length > 0 && w.every(x => hay.includes(x) || (allowType && TYPE_WORDS.has(x)));
};

// Mirrors lib/labelStructure.ts: downgrade ungrounded values to 'low', then in
// production ('warn') BLANK anything low-confidence (prefer empty over a guess).
function applyGrounding(out, raw) {
  if (GROUND_MODE === 'off') return out;
  const hay = norm(raw);
  // A product TYPE is short (1-4 words). A long name = a tagline grabbed as name.
  const isTypeName = (v) => { const w = v.trim().split(/\s+/).filter(Boolean); return w.length >= 1 && w.length <= 4 && v.length <= 32; };
  const proc = (k, allowType = false) => {
    const v = val(out[k]);
    if (!v) return;
    let c = conf(out[k]);
    if (!grounded(v, hay, allowType)) c = 'low';
    if (k === 'name' && !isTypeName(v)) c = 'low';
    if (c === 'low') out[k] = ''; // drop (baseline) and warn (prod) both blank low-confidence
  };
  proc('brand'); proc('name', true); proc('flavor'); proc('size');
  return out;
}

// score a predicted string against an accept-list (substring both ways, normalized)
function fieldPass(pred, accept) {
  const p = norm(pred).trim();
  // expected-empty: accept-list is exactly [""]
  if (accept.length === 1 && accept[0] === '') return p === '';
  if (!p) return false;
  return accept.some(a => { const an = norm(a).trim(); return an && (p.includes(an) || an.includes(p)); });
}

const args = process.argv.slice(2);
const IMG_DIR = args[0] || '/app/public/uploads';
const TRUTH = JSON.parse(fs.readFileSync(args[1] || '/tmp/scan-eval.json', 'utf8'));

const DELAY = Number(process.env.EVAL_DELAY || 0); // ms between images — keeps Groq under the 8000 TPM free-tier bucket
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FIELDS = ['brand','name','flavor','size','category','panel'];
const tally = Object.fromEntries(FIELDS.map(f => [f, { ok:0, n:0 }]));
let allPass = 0, total = 0;

console.log(`reader=${READER_VARIANT}  struct=${STRUCT_VARIANT}  model=${GM}  ground=${GROUND_MODE}\n`);

// EVAL_ONLY=ponds,oreo  -> only score those product keys (cheap sanity runs)
const ONLY = (process.env.EVAL_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
// EVAL_MAXPER=2 -> at most N images per product (covers all products, fewer calls)
const MAXPER = Number(process.env.EVAL_MAXPER || 0);
let entries = Object.entries(TRUTH.files).filter(([, k]) => ONLY.length === 0 || ONLY.includes(k));
if (MAXPER) {
  const seen = {};
  entries = entries.filter(([, k]) => ((seen[k] = (seen[k] || 0) + 1) <= MAXPER));
}
for (const [file, prodKey] of entries) {
  const truth = TRUTH.products[prodKey];
  if (!truth) { console.log(`! no product '${prodKey}' for ${file}`); continue; }
  const path = `${IMG_DIR}/${file}`;
  if (!fs.existsSync(path)) { console.log(`! missing ${file}`); continue; }
  total++;

  const b64 = fs.readFileSync(path).toString('base64');
  let raw = null, out = {}, err = null;
  try { raw = await readImage(b64); } catch (e) { err = 'READ:' + e.message; }
  if (raw) { try { out = applyGrounding(await structure(raw), raw); } catch (e) { err = 'GROQ:' + e.message; } }
  if (out._http || out._nojson || out._badjson) err = 'STRUCT:' + JSON.stringify(out);

  const pred = {
    brand: val(out.brand), name: val(out.name), flavor: val(out.flavor),
    size: val(out.size), category: out.category || '', panel: out.panel || '',
  };
  // panel truth uses 'front'/'back'; for baseline (no panel field) infer from back hints
  if (!pred.panel) {
    const t = (raw||'').toLowerCase();
    const hits = ['nutrition','ingredient','per 100','net wt','net qty','mrp','batch','best before'].filter(k=>t.includes(k)).length;
    pred.panel = hits >= 3 ? 'back' : 'front';
  }

  let rowPass = 0;
  const marks = FIELDS.map(f => {
    const accept = f === 'category' ? [truth.category] : f === 'panel' ? [truth.panel] : truth[f];
    const pass = fieldPass(pred[f], accept);
    tally[f].n++; if (pass) { tally[f].ok++; rowPass++; }
    return `${f}:${pass?'✓':'✗'}`;
  });
  if (rowPass === FIELDS.length) allPass++;
  const tag = `${prodKey}`.padEnd(16);
  console.log(`${file.slice(0,8)} ${tag} ${marks.join(' ')}${err?'  ['+err+']':''}`);
  if (rowPass < FIELDS.length) {
    console.log(`         got: brand="${pred.brand}" name="${pred.name}" flavor="${pred.flavor}" size="${pred.size}" cat="${pred.category}" panel="${pred.panel}"`);
  }
  if (DELAY) await sleep(DELAY);
}

console.log('\n===== per-field accuracy =====');
for (const f of FIELDS) console.log(`  ${f.padEnd(10)} ${tally[f].ok}/${tally[f].n}  ${(100*tally[f].ok/Math.max(1,tally[f].n)).toFixed(0)}%`);
console.log(`  ${'ALL-PASS'.padEnd(10)} ${allPass}/${total}  ${(100*allPass/Math.max(1,total)).toFixed(0)}%`);

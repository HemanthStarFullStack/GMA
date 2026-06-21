// Turn raw OCR items (text + bounding-box height) into best-guess product
// fields. No AI — pure heuristics: quantity by regex (preferring the declared
// net quantity), name/brand by font size. Always imperfect; the scan form stays
// editable so the user corrects whatever's wrong.

import { findProductTerm as findPoolTerm } from "./groceryPool";

// Generic packaging / promo words that slipped into the grocery pool. They appear
// on countless packs ("NEW PACK", "VALUE PACK", "COMBO") and must not be treated
// as the product name — that would wrongly mark a parse "confident".
const POOL_STOP = new Set([
    "pack", "packet", "combo", "offer", "value", "new", "family", "jumbo",
    "saver", "refill", "piece", "pieces", "pcs", "box", "tin", "pouch",
    "bottle", "jar", "carton", "free", "extra",
]);
// A pool match that isn't a generic packaging word.
function findProductTerm(line: string): string | null {
    const t = findPoolTerm(line);
    return t && !POOL_STOP.has(t) ? t : null;
}

export type OcrItem = { text: string; h: number; y: number; x: number; conf: number };
export type ParsedLabel = { name: string; brand: string; flavor: string; quantity: string; price: string; rawText: string; backPanel: boolean; confident: boolean };

// Personal care / household product-type patterns. OCR misreads are common so
// the regex is loose: "lacum" matches "talcum", "powde" matches "powder", etc.
const PRODUCT_TYPE_RE =
    /talcum|lacum|tacum|body\s*(wash|lotion|powder|oil|spray)|face\s*(wash|cream|scrub|pack|mask)|hand\s*(wash|cream|sanitiser|sanitizer)|hair\s*(oil|serum|gel|cream|mask)|shampoo|conditioner|toothpaste|mouthwash|deodorant|antiperspirant|moisturis|sunscreen|sunblock|detergent|dishwash|dish\s*soap|floor\s*cleaner|toilet\s*cleaner|fabric\s*softener/i;

const hasUppercase = (s: string) => /\p{Lu}/u.test(s);
function isProductType(text: string): boolean { return PRODUCT_TYPE_RE.test(text); }

// Marketing / claim text. These are often the BIGGEST type on a pack ("NO ADDED
// SUGAR", "100% NATURAL") and otherwise hijack the brand/name slot. OCR garbles
// big stylised claims ("NO ADDED SUGAR" → "NO SER"), so we also catch a bare
// "NO <word>" and stray claim fragments. Kept tight to avoid demoting real names.
function isMarketing(text: string): boolean {
    const s = text.toLowerCase().trim();
    if (/\b(no\s*added|added\s*sugar|no\s*sugar|sugar\s*free|no\s*preservativ|preservative\s*free|no\s*artificial|100\s*%?|natural|real\s*fruit|with\s*real|no\s*colour|no\s*color)\b/.test(s)) return true;
    if (/^no\s+\w{2,}$/.test(s)) return true;                 // garbled "no ser" / "no uer" / "no added"
    if (/^(added|sugar|free|combo|offer|new)$/.test(s)) return true; // stray claim fragments
    if (/^(new|value|combo|family|jumbo|saver|mega|economy)\s+(pack|packet|offer|size)$/.test(s)) return true; // promo pack badges
    return false;
}

// Common flavor/variant words (esp. Indian beverages & snacks). Matching the
// flavor by dictionary is far more reliable than guessing by font size.
const FLAVORS = [
    "mixed fruit", "mixed berry", "black currant", "tender coconut", "sweet lime",
    "aam panna", "pomegranate", "muskmelon", "watermelon", "blackcurrant",
    "butterscotch", "pistachio", "strawberry", "blueberry", "raspberry",
    "cranberry", "pineapple", "chocolate", "tamarind", "cardamom", "mosambi",
    "coconut", "vanilla", "almond", "saffron", "elaichi", "litchi", "lychee",
    "ginger", "orange", "masala", "banana", "cherry", "guava", "jamun", "mango",
    "apple", "grape", "lemon", "lime", "mint", "kesar", "pista", "badam", "rose",
    "kokum", "jeera", "mojito", "tulsi", "amla", "cola", "peach", "plum", "aam",
];
const FLAVOR_RE = new RegExp(`\\b(${FLAVORS.join("|")})\\b`, "i");

// Map every unit spelling OCR might emit onto a canonical form.
const UNIT_CANON: Record<string, string> = {
    kg: "kg", kgs: "kg",
    g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
    mg: "mg",
    l: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
    ml: "ml", cl: "cl",
    pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs", ct: "pcs", count: "pcs",
};
const UNITS = Object.keys(UNIT_CANON).join("|");
const QTY = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b`, "i");
const QTY_G = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b`, "ig");
// "Net Qty / Net Wt / Net Weight / Net Content / Net Vol"
const NET = /net\s*(?:qty|q|wt|weight|content|vol)/i;

function fmtQty(num: string, unit: string): string {
    return `${num.replace(",", ".")} ${UNIT_CANON[unit.toLowerCase()] ?? unit}`;
}

function onSameLine(a: OcrItem, b: OcrItem): boolean {
    return Math.abs(a.y - b.y) <= Math.max(a.h, b.h, 24);
}

// Pick the pack's net quantity, not a nutrition ("per 100 g") or cooking
// ("240 ml water") number. Scores each unit-bearing item by context.
function extractQuantity(items: OcrItem[], rawText: string): string {
    // Nutrient amounts ("OMEGA-3 (0.6 g)", "Protein 5 g") are not the pack size.
    const NUTRIENT = /(omega|protein|fibre|fiber|fat|carb|sugar|sodium|potass|calcium|iron|energy|vitamin|cholesterol)\s*\S{0,6}$/i;

    // The declared net quantity is authoritative — check it FIRST, before any
    // scattered number (a back panel is full of nutrient amounts that would
    // otherwise win, e.g. "OMEGA-3 (0.6 g)" beating "Net Weight 400 g").
    const net = rawText.match(new RegExp(`net\\s*(?:qty|q|wt|weight|content|vol)\\.?\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b`, "i"));
    if (net) return fmtQty(net[1], net[2]);
    // Net declaration whose unit OCR dropped ("Net Weight: 400 Lot No"): take the
    // number and assume the unit from the wording — weight→g, volume→ml.
    const netNoUnit = rawText.match(/net\s*(wt|weight|qty|q|content|vol)\.?\s*:?\s*(\d{2,5})(?:[.,]\d+)?(?!\s*(?:%|\d))/i);
    if (netNoUnit) {
        const unit = /vol/i.test(netNoUnit[1]) ? "ml" : "g";
        return fmtQty(netNoUnit[2], unit);
    }

    // No explicit net declaration: score each unit-bearing item by context.
    const cands: { num: string; unit: string; score: number; h: number }[] = [];
    for (const it of items) {
        const m = it.text.match(QTY);
        if (!m) continue;
        const low = it.text.toLowerCase();
        let score = 0;
        if (NET.test(low)) score += 10; // "Net Qty 39 g" in one item
        if (items.some((o) => o !== it && NET.test(o.text) && onSameLine(o, it))) score += 8; // label on same line
        if (/\bper\b/.test(low)) score -= 12; // "Per 100 g", "Per serve 39 g"
        if (items.some((o) => /\bper\b/i.test(o.text) && onSameLine(o, it) && o.x < it.x && it.x - o.x < 220)) score -= 6;
        if (/^(ml|cl|l)$/i.test(UNIT_CANON[m[2].toLowerCase()] ?? m[2]) && /(water|cup|pour|cook|boil|flame)/i.test(low)) score -= 8;
        if (/\bextra\b/i.test(low)) score -= 8; // promo badge ("50 g EXTRA"), not net qty
        if (NUTRIENT.test(low.slice(0, m.index)) || /\(\s*$/.test(it.text.slice(0, m.index))) score -= 12; // nutrient amount
        const cu = UNIT_CANON[m[2].toLowerCase()];
        if ((cu === "g" || cu === "ml") && parseFloat(m[1].replace(",", ".")) < 5) score -= 6; // implausibly small for a pack
        cands.push({ num: m[1], unit: m[2], score, h: it.h });
    }
    if (cands.length) {
        cands.sort((a, b) => b.score - a.score || b.h - a.h);
        // Negative best score = unreliable (e.g. promo badge only); fall through to rawText.
        if (cands[0].score >= 0) return fmtQty(cands[0].num, cands[0].unit);
    }
    // Last resort: first plausible unit number in raw text that isn't a "per ...",
    // "extra", nutrient or parenthetical value.
    let m: RegExpExecArray | null;
    QTY_G.lastIndex = 0;
    while ((m = QTY_G.exec(rawText))) {
        const before = rawText.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
        const after = rawText.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
        if (/per\s*$/.test(before)) continue;
        if (/\bextra\b/.test(after)) continue; // promo badge
        if (NUTRIENT.test(before)) continue;   // nutrition value, not pack size
        if (/\($/.test(before.trim())) continue; // "(0.6 g)" parenthetical = nutrition
        // Implausibly small for a pack net weight/volume — usually a nutrient amount.
        const cu = UNIT_CANON[m[2].toLowerCase()];
        if ((cu === "g" || cu === "ml") && parseFloat(m[1].replace(",", ".")) < 5) continue;
        return fmtQty(m[1], m[2]);
    }
    return "";
}

// Extract MRP from raw text. A back panel is full of numbers — batch codes,
// dates, nutrition values, RDA % — so picking the first "Rs.NN" is unreliable
// (it grabbed "Batch No. RS.0.26" instead of MRP 198.00). Instead score every
// price-shaped number by its surroundings and take the best.
function extractPrice(rawText: string): string {
    const text = rawText.replace(/\s+/g, " ");
    const cands: { val: number; score: number }[] = [];
    const consider = (numStr: string, idx: number, len: number, currency: boolean) => {
        const val = parseFloat(numStr.replace(",", "."));
        if (!isFinite(val)) return;
        const before = text.slice(Math.max(0, idx - 18), idx).toLowerCase();
        const after = text.slice(idx + len, idx + len + 6).toLowerCase();
        let score = currency ? 2 : 0;
        if (/mrp/.test(before)) score += 12;                       // right after "MRP"
        if (/(?:\brs\b|\binr\b|₹)/.test(before)) score += 4;       // currency marker
        if (/batch|btch|bath/.test(before)) score -= 20;          // batch code, not price
        if (/per|rda|energy|sodium|potass|protein|carb|\bfat\b|sugar|vitamin|kcal/.test(before)) score -= 15; // nutrition
        if (/^\s*(?:ml|l|g|kg|mg|ltr|gm|gms|grams?|litres?|liters?|pcs?|pc)\b/.test(after)) score -= 30; // size, not price
        if (/%/.test(after)) score -= 15;                          // RDA percentage
        if (/\d{2}[\/.]\d/.test(before) || /[\/.]\d{2,4}\b/.test(after)) score -= 18; // date
        if (/\.\d0$|\.00$|\.50$/.test(numStr)) score += 4;         // MRP-style decimal
        if (val < 1) score -= 12;                                  // sub-rupee implausible as MRP
        if (val > 100000) score -= 20;
        cands.push({ val, score });
    };
    // currency-prefixed numbers (Rs. / ₹ / INR / MRP)
    const cur = /(?:mrp|rs|inr|₹)\.?\s*:?\s*(\d+(?:[.,]\d{1,2})?)/gi;
    let m: RegExpExecArray | null;
    while ((m = cur.exec(text))) consider(m[1], m.index + m[0].lastIndexOf(m[1]), m[1].length, true);
    // standalone MRP-style decimals (e.g. "198.00" when OCR drops the ₹/MRP)
    const dec = /\b(\d+\.\d{2})\b/g;
    while ((m = dec.exec(text))) consider(m[1], m.index, m[1].length, false);

    cands.sort((a, b) => b.score - a.score || b.val - a.val);
    if (cands.length && cands[0].score > 0) {
        const v = cands[0].val;
        return `₹${Number.isInteger(v) ? v : v.toFixed(2)}`;
    }
    return "";
}

// Strip OCR noise punctuation, collapse whitespace.
function clean(s: string): string {
    return s.replace(/[^\p{L}\p{N}&.\-'\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
    return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// A back/nutrition panel has none of the front's brand/name in big type — so
// flag it and let the UI nudge the user to shoot the front instead.
const BACK_HINTS = [
    "nutrition", "ingredient", "per 100", "per serve", "energy", "carbohydrate",
    "best before", "manufactur", "cooking instruction", "fssai", "marketed by", "storage",
    // Statutory back/side-panel markers — a busy nutrition panel often OCRs
    // without the words above but always carries these (Net Wt, MRP, Lot, Mfg).
    "net wt", "net weight", "net qty", "net content", "mrp", "lot no", "batch no",
    "date of mfg", "mfg date", "mfd", "use by", "consume before",
];
function looksLikeBackPanel(rawText: string): boolean {
    const t = rawText.toLowerCase();
    return BACK_HINTS.filter((kw) => t.includes(kw)).length >= 3;
}

export function parseLabel(items: OcrItem[], fullText = ""): ParsedLabel {
    const rawText = (fullText || items.map((i) => i.text).join(" ")).trim();

    // Line-text mode: a plain-text reader (e.g. PaddleOCR-VL) gives clean text
    // but no bounding boxes. Synthesize one "item" per line so the same
    // brand/name/flavor logic applies. No geometry, so every line gets equal
    // height/confidence and selection falls back to reading order + the
    // marketing/flavor/pool rules — which work well on clean text.
    const workItems: OcrItem[] = items.length > 0
        ? items
        : rawText.split(/\r?\n/).map((line, i) => ({ text: line.trim(), h: 1, y: i, x: 0, conf: 1 })).filter((it) => it.text);

    const quantity = extractQuantity(workItems, rawText);
    const price = extractPrice(rawText);
    const backPanel = looksLikeBackPanel(rawText);

    const cand = workItems
        .filter((i) => i.conf >= 0.5)
        .map((i) => ({ h: i.h, y: i.y, conf: i.conf, text: clean(i.text) }))
        .filter((i) => /\p{L}{2,}/u.test(i.text)) // must contain real letters
        .filter((i) => !/^\d+(?:[.,]\d+)?\s*\p{L}{0,4}$/u.test(i.text)) // drop bare quantities
        .sort((a, b) => b.h - a.h);

    // A candidate for name/flavor: uppercase, high-conf, no digits, short (≤5 words),
    // not a product-type descriptor. Used in personal-care branch.
    const isNameCand = (c: (typeof cand)[0]) =>
        hasUppercase(c.text) && c.conf >= 0.85 && !/\d/.test(c.text) &&
        c.text.split(/\s+/).length <= 5 && !isProductType(c.text);

    // Flavor/variant by dictionary first — high precision, font-size independent.
    // Prefer the whole line containing the flavor word ("Zesty Pomegranate",
    // "Mixed Fruit") over the bare match, capped to a short phrase.
    const flavorLine = cand.find((c) => FLAVOR_RE.test(c.text) && c.text.split(/\s+/).length <= 4);
    const flavorHit = flavorLine?.text ?? cand.map((c) => c.text.match(FLAVOR_RE)?.[1]).find(Boolean) ?? "";

    // Candidates eligible to be brand/name: drop marketing claims, which are
    // often the biggest type and would otherwise be picked as the brand.
    const usable = cand.filter((c) => !isMarketing(c.text));
    // Prominence = font height weighted by OCR confidence, so a crisp real brand
    // (conf 1.0) beats a garbled giant claim (conf 0.5).
    const prominence = (c: { h: number; conf: number }) => c.h * Math.max(c.conf, 0.1);

    let name = "";
    let brand = "";
    let flavor = flavorHit;
    // True when we found a real product identity (a food-pool or personal-care
    // product type) plus a brand. The caller trusts this over the small LLM,
    // which tends to corrupt/hallucinate cases the rules already nailed.
    let confident = false;

    // Product-type check first: the grocery pool covers food only, so if we see
    // "talcum powder", "shampoo", etc. we must not use an OFO pool match for "pink
    // lily" (which could be a tea or flower product in the pool).
    if (cand.some((c) => isProductType(c.text))) {
        // Personal care / household: biggest non-marketing text is the brand
        // (e.g. "POND'S"). The product name (e.g. "DREAMFLOWER") is the
        // high-confidence, uppercase, non-type item closest in y to the brand.
        const pc = usable.length ? usable : cand;
        brand = pc[0]?.text ?? "";
        const brandY = pc[0]?.y ?? 0;
        const nameCands = pc
            .filter((c, i) => i !== 0 && isNameCand(c))
            .sort((a, b) => Math.abs(a.y - brandY) - Math.abs(b.y - brandY));
        name = nameCands[0]?.text ?? pc.find((c) => isProductType(c.text))?.text ?? "";
        if (!flavor) flavor = nameCands.slice(1).find((c) => c.text.split(/\s+/).length <= 4)?.text ?? "";
        confident = !!brand && !!name;
    } else {
        // A pool term that is ALSO a flavor word (chocolate, mango) is the variant,
        // not the product — e.g. "Dark Chocolate" on a muesli pack. Prefer a
        // non-flavor pool term ("muesli") as the name; only fall back to a
        // flavor-ish term if that's the only pool match present.
        const matched = (c: (typeof usable)[0]) => findProductTerm(c.text);
        let productIdx = usable.findIndex((c) => { const t = matched(c); return !!t && !FLAVOR_RE.test(t); });
        if (productIdx < 0) productIdx = usable.findIndex((c) => matched(c));
        if (productIdx >= 0) {
            // Food pool match: pool term = product name; most prominent remaining
            // non-pool, non-flavor candidate = brand (height × confidence).
            name = usable[productIdx].text;
            brand = usable
                .filter((c, i) => i !== productIdx && !findProductTerm(c.text) && !FLAVOR_RE.test(c.text))
                .sort((a, b) => prominence(b) - prominence(a))[0]?.text ?? "";
            confident = !!brand;
        } else {
            // No pool match: rank by prominence among non-flavor lines. Biggest =
            // name, next = brand. A flavor line is never name/brand (it's the
            // variant), so a "SWING / Zesty Pomegranate" front yields name=Swing,
            // flavor=Zesty Pomegranate — not brand=Zesty Pomegranate.
            const ranked = usable.filter((c) => !FLAVOR_RE.test(c.text)).sort((a, b) => prominence(b) - prominence(a));
            name = ranked[0]?.text ?? "";
            brand = ranked.find((c) => c.text !== name)?.text ?? "";
        }
        if (!flavor) {
            flavor = usable.find((c) =>
                c.text !== name && c.text !== brand &&
                !isProductType(c.text) && !/\d/.test(c.text) &&
                c.text.split(/\s+/).length <= 4 && hasUppercase(c.text)
            )?.text ?? "";
        }
    }

    return { name: titleCase(name), brand: titleCase(brand), flavor: titleCase(flavor), quantity, price, rawText, backPanel, confident };
}

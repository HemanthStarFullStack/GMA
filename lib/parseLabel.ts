// Turn raw OCR items (text + bounding-box height) into best-guess product
// fields. No AI — pure heuristics: quantity by regex (preferring the declared
// net quantity), name/brand by font size. Always imperfect; the scan form stays
// editable so the user corrects whatever's wrong.

import { findProductTerm } from "./groceryPool";

export type OcrItem = { text: string; h: number; y: number; x: number; conf: number };
export type ParsedLabel = { name: string; brand: string; flavor: string; quantity: string; price: string; rawText: string; backPanel: boolean };

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
        cands.push({ num: m[1], unit: m[2], score, h: it.h });
    }
    if (cands.length) {
        cands.sort((a, b) => b.score - a.score || b.h - a.h);
        // Negative best score = unreliable (e.g. promo badge only); fall through to rawText.
        if (cands[0].score >= 0) return fmtQty(cands[0].num, cands[0].unit);
    }
    // No item-level boxes (e.g. tests pass only rawText): prefer a net-qty
    // declaration, else the first unit number that isn't a "per ..." or "extra" value.
    const net = rawText.match(new RegExp(`net\\s*(?:qty|q|wt|weight|content|vol)\\.?\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})`, "i"));
    if (net) return fmtQty(net[1], net[2]);
    let m: RegExpExecArray | null;
    QTY_G.lastIndex = 0;
    while ((m = QTY_G.exec(rawText))) {
        const before = rawText.slice(Math.max(0, m.index - 5), m.index).toLowerCase();
        const after = rawText.slice(m.index + m[0].length, m.index + m[0].length + 10).toLowerCase();
        if (/per\s*$/.test(before)) continue;
        if (/\bextra\b/.test(after)) continue; // promo badge
        return fmtQty(m[1], m[2]);
    }
    return "";
}

// Extract MRP/price from raw text. Tries MRP+currency first (most specific),
// then standalone ₹/Rs markers. Returns "₹X" or "" if not found.
const PRICE_RE = [
    /MRP\.?\s*(?:Rs\.?|₹)\s*(\d+(?:[.,]\d{1,2})?)/i,   // MRP Rs. 25  /  MRP ₹25
    /(?:Rs\.?|₹)\s*(\d+(?:[.,]\d{1,2})?)(?:\s*\/-?)?/i, // Rs. 50/-  /  ₹199
    /MRP\.?\s*:?\s*(\d+(?:[.,]\d{1,2})?)/i,              // MRP: 25  /  MRP 25.00
];
function extractPrice(rawText: string): string {
    for (const re of PRICE_RE) {
        const m = rawText.match(re);
        if (m) return `₹${m[1].replace(",", ".")}`;
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
];
function looksLikeBackPanel(rawText: string): boolean {
    const t = rawText.toLowerCase();
    return BACK_HINTS.filter((kw) => t.includes(kw)).length >= 3;
}

export function parseLabel(items: OcrItem[], fullText = ""): ParsedLabel {
    const rawText = (fullText || items.map((i) => i.text).join(" ")).trim();
    const quantity = extractQuantity(items, rawText);
    const price = extractPrice(rawText);
    const backPanel = looksLikeBackPanel(rawText);

    const cand = items
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
    const flavorHit = cand.map((c) => c.text.match(FLAVOR_RE)?.[1]).find(Boolean) ?? "";

    // Candidates eligible to be brand/name: drop marketing claims, which are
    // often the biggest type and would otherwise be picked as the brand.
    const usable = cand.filter((c) => !isMarketing(c.text));
    // Prominence = font height weighted by OCR confidence, so a crisp real brand
    // (conf 1.0) beats a garbled giant claim (conf 0.5).
    const prominence = (c: { h: number; conf: number }) => c.h * Math.max(c.conf, 0.1);

    let name = "";
    let brand = "";
    let flavor = flavorHit;

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
    } else {
        const productIdx = usable.findIndex((c) => findProductTerm(c.text));
        if (productIdx >= 0) {
            // Food pool match: pool term = product name; most prominent remaining
            // non-pool, non-flavor candidate = brand (height × confidence).
            name = usable[productIdx].text;
            brand = usable
                .filter((c, i) => i !== productIdx && !findProductTerm(c.text) && !FLAVOR_RE.test(c.text))
                .sort((a, b) => prominence(b) - prominence(a))[0]?.text ?? "";
        } else {
            // No pool match: rank by prominence. Biggest = name, next = brand.
            const ranked = [...usable].sort((a, b) => prominence(b) - prominence(a));
            name = ranked[0]?.text ?? "";
            brand = ranked.find((c) => c.text !== name && !FLAVOR_RE.test(c.text))?.text ?? ranked[1]?.text ?? "";
        }
        if (!flavor) {
            flavor = usable.find((c) =>
                c.text !== name && c.text !== brand &&
                !isProductType(c.text) && !/\d/.test(c.text) &&
                c.text.split(/\s+/).length <= 4 && hasUppercase(c.text)
            )?.text ?? "";
        }
    }

    return { name: titleCase(name), brand: titleCase(brand), flavor: titleCase(flavor), quantity, price, rawText, backPanel };
}

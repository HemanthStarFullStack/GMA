// Turn raw OCR items (text + bounding-box height) into best-guess product
// fields. No AI — pure heuristics: quantity by regex (preferring the declared
// net quantity), name/brand by font size. Always imperfect; the scan form stays
// editable so the user corrects whatever's wrong.

import { findProductTerm } from "./groceryPool";

export type OcrItem = { text: string; h: number; y: number; x: number; conf: number };
export type ParsedLabel = { name: string; brand: string; quantity: string; rawText: string; backPanel: boolean };

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
        cands.push({ num: m[1], unit: m[2], score, h: it.h });
    }
    if (cands.length) {
        cands.sort((a, b) => b.score - a.score || b.h - a.h);
        return fmtQty(cands[0].num, cands[0].unit);
    }
    // No item-level boxes (e.g. tests pass only rawText): prefer a net-qty
    // declaration, else the first unit number that isn't a "per ..." value.
    const net = rawText.match(new RegExp(`net\\s*(?:qty|q|wt|weight|content|vol)\\.?\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})`, "i"));
    if (net) return fmtQty(net[1], net[2]);
    let m: RegExpExecArray | null;
    QTY_G.lastIndex = 0;
    while ((m = QTY_G.exec(rawText))) {
        const before = rawText.slice(Math.max(0, m.index - 5), m.index).toLowerCase();
        if (/per\s*$/.test(before)) continue;
        return fmtQty(m[1], m[2]);
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
    const backPanel = looksLikeBackPanel(rawText);

    const cand = items
        .filter((i) => i.conf >= 0.5)
        .map((i) => ({ h: i.h, y: i.y, text: clean(i.text) }))
        .filter((i) => /\p{L}{2,}/u.test(i.text)) // must contain real letters
        .filter((i) => !/^\d+(?:[.,]\d+)?\s*\p{L}{0,4}$/u.test(i.text)) // drop bare quantities
        .sort((a, b) => b.h - a.h);

    // Identify the product by matching the grocery pool — font size is unreliable
    // (the brand logo is often the biggest text). The prominent line that's a
    // known grocery term is the product; the biggest leftover is the brand.
    let name = "";
    let brand = "";
    const productIdx = cand.findIndex((c) => findProductTerm(c.text));
    if (productIdx >= 0) {
        name = cand[productIdx].text;
        brand = cand.find((c, i) => i !== productIdx && !findProductTerm(c.text))?.text ?? "";
    } else {
        // No known product noun (e.g. a sub-brand like "Dark Fantasy") — fall
        // back to font size: biggest = name, next on a different line = brand.
        name = cand[0]?.text ?? "";
        const nameY = cand[0]?.y ?? 0;
        const nameH = cand[0]?.h ?? 0;
        brand =
            cand.slice(1).find((c) => Math.abs(c.y - nameY) > nameH * 0.5)?.text ??
            cand[1]?.text ??
            "";
    }

    return { name: titleCase(name), brand: titleCase(brand), quantity, rawText, backPanel };
}

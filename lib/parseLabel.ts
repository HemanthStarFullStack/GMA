// Turn raw OCR items (text + bounding-box height) into best-guess product
// fields. No AI — pure heuristics: quantity by regex, name/brand by font size
// (taller box = bigger text = more prominent on the pack). Always imperfect;
// the scan form stays editable so the user corrects whatever's wrong.

export type OcrItem = { text: string; h: number; y: number; x: number; conf: number };
export type ParsedLabel = { name: string; brand: string; quantity: string; rawText: string };

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

function extractQuantity(text: string): string {
    const m = text.match(QTY);
    if (!m) return "";
    const num = m[1].replace(",", ".");
    const unit = UNIT_CANON[m[2].toLowerCase()] ?? m[2];
    return `${num} ${unit}`;
}

// Strip OCR noise punctuation, collapse whitespace.
function clean(s: string): string {
    return s.replace(/[^\p{L}\p{N}&.\-'\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function titleCase(s: string): string {
    return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function parseLabel(items: OcrItem[], fullText = ""): ParsedLabel {
    const rawText = (fullText || items.map((i) => i.text).join(" ")).trim();
    const quantity = extractQuantity(rawText);

    const cand = items
        .filter((i) => i.conf >= 0.5)
        .map((i) => ({ h: i.h, y: i.y, text: clean(i.text) }))
        .filter((i) => /\p{L}{2,}/u.test(i.text)) // must contain real letters
        .filter((i) => !/^\d+(?:[.,]\d+)?\s*\p{L}{0,4}$/u.test(i.text)) // drop bare quantities
        .sort((a, b) => b.h - a.h);

    // Biggest text = product name (most common pack layout). Brand = next
    // biggest on a different visual line. Coin-flip between the two on some
    // packs; the user fixes it in the form.
    const name = cand[0]?.text ?? "";
    const nameY = cand[0]?.y ?? 0;
    const nameH = cand[0]?.h ?? 0;
    const brand =
        cand.slice(1).find((c) => Math.abs(c.y - nameY) > nameH * 0.5)?.text ??
        cand[1]?.text ??
        "";

    return { name: titleCase(name), brand: titleCase(brand), quantity, rawText };
}

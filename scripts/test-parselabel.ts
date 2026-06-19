// Self-check for the OCR label parser. Run: node scripts/test-parselabel.ts
import { parseLabel, type OcrItem } from "../lib/parseLabel.ts";
import { findProductTerm } from "../lib/groceryPool.ts";

let pass = 0,
    fail = 0;
function check(label: string, got: unknown, want: unknown) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(`${ok ? "✓" : "✗"} ${label}: got ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}`);
    ok ? pass++ : fail++;
}

// quantity extraction across spellings/spacing
const qty = (t: string) => parseLabel([], t).quantity;
check("qty 1 L", qty("Amul Taaza Toned Milk 1 L"), "1 L");
check("qty 500g no space", qty("Aashirvaad Atta 500g"), "500 g");
check("qty net wt", qty("Maggi Noodles Net Wt 70 gm"), "70 g");
check("qty litre word", qty("Coca Cola 2 litre bottle"), "2 L");
check("qty decimal", qty("Sprite 1.25 ltr"), "1.25 L");
check("qty pcs", qty("Eggs pack of 6 pcs"), "6 pcs");
check("qty none", qty("Just a brand name"), "");

// grocery pool: brands rejected, products matched (powers the product/brand split)
check("pool rejects brand", findProductTerm("Saffola"), null);
check("pool matches product", !!findProductTerm("Masala Oats"), true);

// Front pack, brand logo BIGGER than the product name. The pool must still pick
// the product as name and the brand as brand — no font-size swap.
const front: OcrItem[] = [
    { text: "Saffola", h: 80, y: 60, x: 20, conf: 0.96 },      // brand logo — biggest
    { text: "Masala Oats", h: 50, y: 180, x: 20, conf: 0.95 }, // product — smaller
    { text: "Classic", h: 30, y: 260, x: 20, conf: 0.9 },
    { text: "Net Qty 39 g", h: 24, y: 600, x: 20, conf: 0.95 },
    { text: "x!?", h: 90, y: 500, x: 10, conf: 0.2 },          // low-conf noise, dropped
];
const f = parseLabel(front, "Saffola Masala Oats Classic Net Qty 39 g");
check("product becomes name (not the bigger brand)", f.name, "Masala Oats");
check("brand from leftover prominent text", f.brand, "Saffola");
check("quantity from net qty", f.quantity, "39 g");
check("front not flagged as back", f.backPanel, false);
check("low-conf noise dropped", [f.name, f.brand].includes("X!?"), false);

// nutrition panel: prefer "Net Qty 39 g" over "Per 100 g"
const back: OcrItem[] = [
    { text: "Per 100 g", h: 30, y: 100, x: 400, conf: 0.95 },
    { text: "411", h: 28, y: 140, x: 400, conf: 0.95 },
    { text: "Net Qty.:", h: 32, y: 900, x: 20, conf: 0.93 },
    { text: "39 g", h: 34, y: 900, x: 160, conf: 0.99 },
    { text: "Pour 240 ml water into the pan", h: 24, y: 60, x: 400, conf: 0.9 },
    { text: "NUTRITIONAL INFORMATION", h: 30, y: 80, x: 400, conf: 0.95 },
    { text: "INGREDIENTS", h: 30, y: 700, x: 20, conf: 0.95 },
    { text: "BEST BEFORE 9 MONTHS", h: 26, y: 950, x: 20, conf: 0.9 },
];
const b = parseLabel(back);
check("net qty beats 'per 100 g'", b.quantity, "39 g");
check("cooking 'per/water ml' not picked", b.quantity !== "240 ml", true);
check("back panel detected", b.backPanel, true);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

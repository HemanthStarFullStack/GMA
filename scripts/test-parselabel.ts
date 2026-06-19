// Self-check for the OCR label parser. Run: node scripts/test-parselabel.ts
import { parseLabel, type OcrItem } from "../lib/parseLabel.ts";

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

// font-size ranking: biggest box = name; quantity excluded from name/brand
const items: OcrItem[] = [
    { text: "TAAZA", h: 70, y: 200, x: 10, conf: 0.95 },
    { text: "Amul", h: 40, y: 80, x: 10, conf: 0.93 },
    { text: "Toned Milk", h: 30, y: 300, x: 10, conf: 0.9 },
    { text: "1 L", h: 25, y: 400, x: 10, conf: 0.96 },
    { text: "x!?", h: 60, y: 500, x: 10, conf: 0.2 }, // low conf noise, dropped
];
const p = parseLabel(items, "Amul TAAZA Toned Milk 1 L");
check("name = biggest confident text", p.name, "Taaza");
check("brand = next on different line", p.brand, "Amul");
check("quantity parsed", p.quantity, "1 L");
check("low-conf noise dropped from name/brand", [p.name, p.brand].includes("X!?"), false);
check("quantity not in name/brand", [p.name, p.brand].some((s) => s.includes("1 L")), false);

console.log(`\n${pass}/${pass + fail} passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);

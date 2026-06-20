// Tests the SHIPPED parser (lib/parseLabel.ts) against real OCR output from the
// Storia scan + edge cases. Run: npx tsx scripts/sim-parselabel.ts
import { parseLabel, type OcrItem } from "../lib/parseLabel";

let fails = 0;
function check(name: string, got: Record<string, string>, want: Record<string, string>) {
    const ok = Object.entries(want).every(([k, v]) => (got[k] || "").toLowerCase() === v.toLowerCase());
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) { console.log("   got :", JSON.stringify(got)); console.log("   want:", JSON.stringify(want)); fails++; }
}
const I = (text: string, h: number, conf: number, y = 0, x = 0): OcrItem => ({ text, h, conf, y, x });

// --- Real OCR from the actual scan (67197118…, captured from the sidecar) ---
check("1 Storia juice (latest scan)", parseLabel([
    I("NO SER", 100, 0.53, 120, 257),
    I("Storia", 62, 1.0, 350, 266),
    I("POMEGRANATE", 56, 0.99, 788, 222),
    I("JUICE", 38, 1.0, 425, 273),
]), { name: "Juice", brand: "Storia", flavor: "Pomegranate" });

// --- Real OCR from the previous angle (0d0f753c…) ---
check("2 Storia juice (prev angle)", parseLabel([
    I("NO UER", 94, 0.77, 150),
    I("ADDED", 45, 0.98, 156),
    I("Storia", 65, 0.99, 399),
    I("POMEGRANATE", 65, 0.99, 807),
    I("JUICE", 44, 1.0, 475),
]), { name: "Juice", brand: "Storia", flavor: "Pomegranate" });

// --- Marketing claim is the biggest AND high-conf: must still be ignored ---
check("3 big crisp claim ignored", parseLabel([
    I("100% NATURAL", 110, 0.99, 100),
    I("Tropicana", 70, 0.99, 300),
    I("JUICE", 50, 0.99, 450),
    I("ORANGE", 48, 0.99, 700),
]), { name: "Juice", brand: "Tropicana", flavor: "Orange" });

// --- Multi-word flavor ---
check("4 multi-word flavor", parseLabel([
    I("Real", 80, 0.99, 100),
    I("JUICE", 50, 0.99, 300),
    I("MIXED FRUIT", 46, 0.99, 700),
]), { name: "Juice", brand: "Real", flavor: "Mixed Fruit" });

// --- Personal care still works (Pond's), marketing-safe ---
check("5 personal care unaffected", parseLabel([
    I("POND'S", 90, 0.99, 200),
    I("DREAMFLOWER", 60, 0.95, 300),
    I("TALCUM POWDER", 40, 0.95, 500),
    I("PINK LILY", 38, 0.9, 600),
]), { brand: "Pond'S", name: "Dreamflower" });

// --- Real back-panel OCR (from the [vision] log): MRP must be 198, not the
//     batch number 0.26 or any nutrition/RDA value. ---
const BACK_RAW = " l)\nINGREDIENTS\nAe  \nConcentrate 4%,\n\nxidant [NS300].\n%u\nANSADER AN ANCES (POMEGRANATE) SUBSTANC NUTRITIONAL INFORMATION\n(Approximate values)\nngi \nPer 100 ml KRDA*\nEnergy 46 kcal 2.30%\nFat Og 0%\nCarbohydrate* 11.4g\nTotal Sugar 11.4g\nAdded Sugar og 0%\nProtein Og 0%\nSodium 50 mg 2.50%\nPotassium 20 mg 0.60%\nVitamin C 8 mg\n10%\nRDA calculated as per 2000 kcal energy based on ICMR 2020.\nNet Qty.\nMRP\n 750ml\n(cof aes)\nUSP 198.00\nBatch No. RS.0.26 P\n Dat T68215001\n30/05/2026\n 2402/2027\n8900085\nALSWEETEN NATURALSEN CONTAINS ON-CALIC Er\nFRUIT SUGARS. T";
{
    const r = parseLabel([], BACK_RAW);
    check("6 back panel MRP (not batch/RDA)", { price: r.price, backPanel: String(r.backPanel) }, { price: "₹198", backPanel: "true" });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
if (fails) process.exit(1);

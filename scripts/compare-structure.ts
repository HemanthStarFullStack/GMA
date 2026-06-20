// Compares the new LLM structurer (qwen2.5:1.5b) against parseLabel's heuristics
// on known OCR texts. Requires Ollama up with the model.
// Run: OLLAMA_URL=http://127.0.0.1:11434 npx tsx scripts/compare-structure.ts
import { parseLabel } from "../lib/parseLabel";
import { structureLabel } from "../lib/labelStructure";

const cases: { label: string; text: string }[] = [
    { label: "Swing (brand+flavor only)", text: "SWING\nZesty Pomegranate" },
    { label: "Storia front", text: "NO ADDED SUGAR\nStoria\nJUICE\nPOMEGRANATE" },
    { label: "Tropicana", text: "100% NATURAL\nTropicana\nJUICE\nORANGE" },
    { label: "Pond's", text: "POND'S\nDREAMFLOWER\nTALCUM POWDER\nPINK LILY" },
    { label: "Amul butter", text: "Amul\nButter\nPasteurised" },
];

async function main() {
    for (const c of cases) {
        const heur = parseLabel([], c.text);
        const llm = await structureLabel(c.text);
        // Merge exactly as the route does: LLM brand/name, parseLabel flavor first.
        const merged = {
            brand: (llm?.brand) || heur.brand,
            name: (llm?.name) || heur.name,
            flavor: heur.flavor || (llm?.flavor ?? ""),
        };
        console.log(`\n=== ${c.label} ===`);
        console.log(`  text  : ${JSON.stringify(c.text)}`);
        console.log(`  parse : brand=${heur.brand} | name=${heur.name} | flavor=${heur.flavor}`);
        console.log(`  LLM   : ${llm ? `brand=${llm.brand} | name=${llm.name} | flavor=${llm.flavor}` : "(null)"}`);
        console.log(`  SHIP  : brand=${merged.brand} | name=${merged.name} | flavor=${merged.flavor}`);
    }
}
main();

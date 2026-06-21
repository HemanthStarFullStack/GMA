// End-to-end reader comparison: for each image run BOTH readers through the real
// parseLabel + structureLabel pipeline and print final fields + latency, so we
// can see whether the fast CPU sidecar regresses quality vs the slow GPU VLM.
//
// Needs: VLM on VISION_OCR_URL, sidecar on OCR_HTTP_URL (temporarily exposed),
// Ollama on OLLAMA_URL with the struct model.
// Run: npx tsx scripts/bench-readers.ts _uploads_tmp/*.jpg
import { readFileSync } from "fs";
import { parseLabel, type OcrItem } from "../lib/parseLabel";
import { readLabelText } from "../lib/visionOcr";
import { structureLabel } from "../lib/labelStructure";

const SIDECAR = process.env.OCR_HTTP_URL || "http://127.0.0.1:4000";

async function viaSidecar(buf: Buffer) {
    const t0 = Date.now();
    const res = await fetch(`${SIDECAR}/ocr`, {
        method: "POST", headers: { "content-type": "application/octet-stream" },
        body: buf, signal: AbortSignal.timeout(30_000),
    });
    const ocr: { text?: string; items?: OcrItem[] } = await res.json();
    const parsed = parseLabel(ocr.items ?? [], ocr.text ?? "");
    const fields = parsed.backPanel ? null : await structureLabel(parsed.rawText);
    if (fields) {
        if (fields.brand) parsed.brand = fields.brand;
        if (fields.name) parsed.name = fields.name;
        if (!parsed.flavor) parsed.flavor = fields.flavor;
    }
    return { ms: Date.now() - t0, parsed };
}

async function viaVlm(buf: Buffer) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const t0 = Date.now();
    const text = await readLabelText(ab);
    if (!text) return { ms: Date.now() - t0, parsed: null };
    const parsed = parseLabel([], text);
    const fields = parsed.backPanel ? null : await structureLabel(text);
    if (fields) {
        if (fields.brand) parsed.brand = fields.brand;
        if (fields.name) parsed.name = fields.name;
        if (!parsed.flavor) parsed.flavor = fields.flavor;
    }
    return { ms: Date.now() - t0, parsed };
}

const fmt = (p: any) => p ? `name=${p.name} | brand=${p.brand} | flavor=${p.flavor} | qty=${p.quantity} | price=${p.price} | back=${p.backPanel}` : "(null)";

async function main() {
    for (const path of process.argv.slice(2)) {
        const buf = readFileSync(path);
        console.log(`\n######## ${path.split(/[\\/]/).pop()} ########`);
        const s = await viaSidecar(buf);
        const v = await viaVlm(buf);
        console.log(`  SIDECAR ${String(s.ms).padStart(6)}ms  ${fmt(s.parsed)}`);
        console.log(`  VLM     ${String(v.ms).padStart(6)}ms  ${fmt(v.parsed)}`);
    }
}
main();

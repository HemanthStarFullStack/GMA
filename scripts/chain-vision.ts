// Full-chain check: image -> visionOcr (PaddleOCR-VL) -> parseLabel, exactly as
// /api/product-vision runs it. Requires llama-server up on VISION_OCR_URL.
// Run: VISION_OCR_URL=http://127.0.0.1:8185 npx tsx scripts/chain-vision.ts <img>
import { readFileSync } from "fs";
import { readLabelText } from "../lib/visionOcr";
import { parseLabel } from "../lib/parseLabel";

async function main() {
    const path = process.argv[2] || "scripts/_front.jpg";
    const buf = readFileSync(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

    const t0 = Date.now();
    const text = await readLabelText(ab as ArrayBuffer);
    const ms = Date.now() - t0;

    if (!text) {
        console.log(`readLabelText returned null (server down or disabled) after ${ms}ms`);
        process.exit(1);
    }
    console.log(`--- raw VLM text (${ms}ms) ---\n${text}`);
    const parsed = parseLabel([], text);
    console.log("--- parsed ---");
    console.log(JSON.stringify({ name: parsed.name, brand: parsed.brand, flavor: parsed.flavor, quantity: parsed.quantity, price: parsed.price, backPanel: parsed.backPanel }, null, 2));
}
main();

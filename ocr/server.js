// Internal OCR sidecar. Receives raw image bytes, returns recognized text
// items with their bounding-box heights (font-size proxy) so the caller can
// rank brand/name. PP-OCRv5 via ONNX Runtime — CPU, free, no external API.
//
// Not exposed publicly — only the app reaches it over the Docker network.
import { createServer } from "node:http";
import { PaddleOcrService } from "ppu-paddle-ocr";
import sharp from "sharp";

const PORT = 4000;
const MAX_BYTES = 12 * 1024 * 1024; // reject oversized uploads at the boundary

// per-box strategy: recognize each detected region on its own. On dense,
// multi-column packs (nutrition/back panels) the default per-line merges across
// columns and garbles text; per-box keeps each line clean.
const ocr = new PaddleOcrService({ recognition: { strategy: "per-box" } });
await ocr.initialize(); // loads the model into memory once at boot
console.log(`[ocr] model ready, listening on :${PORT}`);

// Preprocess the raw image buffer before OCR:
//   normalize  — auto-levels: corrects washed-out / underexposed shots
//   sharpen    — unsharp mask: crisps character edges for better detection
//   upscale    — if longest edge < 900 px, PP-OCR misses small text regions
// Falls back to the original buffer on any error (unsupported format, corrupt).
async function preprocess(buf) {
    try {
        const meta = await sharp(buf).metadata();
        const maxEdge = Math.max(meta.width || 0, meta.height || 0);
        let pipeline = sharp(buf);
        if (maxEdge > 0 && maxEdge < 900) {
            const s = 900 / maxEdge;
            pipeline = pipeline.resize(Math.round((meta.width || 900) * s), Math.round((meta.height || 900) * s));
        }
        return await pipeline.normalize().sharpen({ sigma: 1.2 }).jpeg({ quality: 93 }).toBuffer();
    } catch (e) {
        console.warn("[ocr] preprocess failed, using original:", e?.message);
        return buf;
    }
}

// ponytail: serial lock — one recognition at a time. A shared OCR session
// isn't safe to call concurrently. Add a worker pool only if throughput needs it.
let lock = Promise.resolve();
function recognizeSerial(ab) {
    const prev = lock;
    let release;
    lock = new Promise((r) => (release = r));
    return prev.then(() => ocr.recognize(ab, { flatten: true })).finally(() => release());
}

const server = createServer(async (req, res) => {
    const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
    };

    if (req.method === "GET" && req.url === "/health") return json(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/ocr") return json(404, { error: "not found" });

    if (Number(req.headers["content-length"] || 0) > MAX_BYTES) return json(413, { error: "image too large" });

    try {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
            size += c.length;
            if (size > MAX_BYTES) {
                req.destroy();
                return json(413, { error: "image too large" });
            }
            chunks.push(c);
        }
        const buf = Buffer.concat(chunks);
        if (buf.byteLength < 100) return json(400, { error: "empty image" });

        const enhanced = await preprocess(buf);
        const ab = enhanced.buffer.slice(enhanced.byteOffset, enhanced.byteOffset + enhanced.byteLength);
        const r = await recognizeSerial(ab);
        const items = r.results.map((it) => ({
            text: it.text,
            h: it.box.height,
            y: it.box.y,
            x: it.box.x,
            conf: it.confidence,
        }));
        json(200, { text: r.text, confidence: r.confidence, items });
    } catch (e) {
        console.warn("[ocr] recognize failed:", e?.message || e);
        json(500, { error: "recognition failed" });
    }
});

server.listen(PORT);

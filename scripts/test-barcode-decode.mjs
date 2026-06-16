/**
 * Real-time decode test for the barcode scanner pipeline.
 *
 * Mirrors components/BarcodeScanner.tsx `decodeImageFile`:
 *   multi-scale (cap 1000 / 1600 / raw) × multi-rotation (0/90/180/270)
 *   × dual-binarizer (Hybrid then GlobalHistogram), first hit wins.
 *
 * Browser uses HTMLCanvasElementLuminanceSource; here we feed sharp's
 * 1-channel grayscale straight into RGBLuminanceSource (identical luminance
 * bytes), so the decode algorithm under test is the same one shipping.
 *
 * Run: node scripts/test-barcode-decode.mjs
 */
import bwipjs from "bwip-js/node";
import sharp from "sharp";
import {
    DecodeHintType,
    BarcodeFormat,
    MultiFormatReader,
    BinaryBitmap,
    HybridBinarizer,
    GlobalHistogramBinarizer,
    RGBLuminanceSource,
} from "@zxing/library";

const RETAIL_FORMATS = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
];

function makeCoreReader() {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const r = new MultiFormatReader();
    r.setHints(hints);
    return r;
}

// sharp grayscale raw -> RGBLuminanceSource (1 byte/pixel == luminance)
async function rawToBitmap(buf, binarizer) {
    const { data, info } = await sharp(buf)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const lum = new Uint8ClampedArray(data.buffer, data.byteOffset, info.width * info.height);
    const source = new RGBLuminanceSource(lum, info.width, info.height);
    return new BinaryBitmap(new binarizer(source));
}

async function tryDecode(reader, pngBuf) {
    for (const Bin of [HybridBinarizer, GlobalHistogramBinarizer]) {
        try {
            const bitmap = await rawToBitmap(pngBuf, Bin);
            return reader.decodeWithState(bitmap).getText().trim();
        } catch { /* next binarizer */ }
    }
    return null;
}

// Replicates decodeImageFile: scale set + rotation set, first success wins.
async function decodeImageFile(pngBuf) {
    const meta = await sharp(pngBuf).metadata();
    const long = Math.max(meta.width, meta.height);
    const scales = [...new Set([
        long > 1000 ? 1000 / long : 1,
        long > 1600 ? 1600 / long : 1,
        1,
    ])];
    const reader = makeCoreReader();

    for (const scale of scales) {
        for (const rot of [0, 90, 180, 270]) {
            let pipe = sharp(pngBuf);
            if (scale !== 1) {
                pipe = pipe.resize(Math.max(1, Math.round(meta.width * scale)));
            }
            if (rot !== 0) pipe = pipe.rotate(rot);
            const variant = await pipe.png().toBuffer();
            const text = await tryDecode(reader, variant);
            if (text) return { text, scale: +scale.toFixed(3), rot };
        }
    }
    return null;
}

async function genBarcode(bcid, text, big = false) {
    const raw = await bwipjs.toBuffer({
        bcid,
        text,
        scale: big ? 6 : 3,
        height: big ? 30 : 12,
        includetext: false,
    });
    // Add a white quiet zone + flatten — every real barcode photo has margins,
    // and EAN/UPC need them to lock on.
    const pad = big ? 80 : 40;
    return sharp(raw)
        .flatten({ background: "#ffffff" })
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
        .png().toBuffer();
}

// expected = what zxing returns (EAN/UPC include check digit)
const cases = [
    { name: "EAN-13",        bcid: "ean13",   text: "5901234123457", expected: "5901234123457" },
    { name: "UPC-A",         bcid: "upca",    text: "036000291452",  expected: "036000291452" },
    { name: "CODE-128",      bcid: "code128", text: "TEST-12345",    expected: "TEST-12345" },
    { name: "EAN-13 (large)",bcid: "ean13",   text: "4006381333931", expected: "4006381333931", big: true },
];

const rotations = [0, 90, 180, 270];
let pass = 0, fail = 0;

console.log("Barcode decode pipeline test (mirrors decodeImageFile)\n");

// Oversized phone-photo case: upscale to ~2600px long side so the
// downscale branch (cap 1000 / 1600) must engage to decode.
{
    const base = await genBarcode("ean13", "5012345678900");
    const huge = await sharp(base).resize(2600).png().toBuffer();
    const dims = await sharp(huge).metadata();
    const res = await decodeImageFile(huge);
    const ok = res && res.text === "5012345678900";
    if (ok) pass++; else fail++;
    console.log(
        `${ok ? "PASS" : "FAIL"}  ${"EAN-13 (oversized)".padEnd(18)} ` +
        `img ${dims.width}x${dims.height}  ` +
        (res ? `-> "${res.text}" (solved at scale ${res.scale}, rot ${res.rot})` : "-> NO DECODE")
    );
}

for (const c of cases) {
    const png = await genBarcode(c.bcid, c.text, c.big);
    const dims = await sharp(png).metadata();
    for (const baseRot of rotations) {
        const input = baseRot === 0 ? png : await sharp(png).rotate(baseRot).png().toBuffer();
        const res = await decodeImageFile(input);
        const ok = res && res.text === c.expected;
        if (ok) pass++; else fail++;
        const detail = res
            ? `-> "${res.text}" (solved at scale ${res.scale}, rot ${res.rot})`
            : "-> NO DECODE";
        console.log(
            `${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(15)} ` +
            `img ${dims.width}x${dims.height} rotated ${String(baseRot).padStart(3)}deg  ${detail}`
        );
    }
}

console.log(`\nResult: ${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);

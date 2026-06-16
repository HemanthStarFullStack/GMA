"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls, HTMLCanvasElementLuminanceSource } from "@zxing/browser";
import {
    DecodeHintType,
    BarcodeFormat,
    MultiFormatReader,
    BinaryBitmap,
    HybridBinarizer,
    GlobalHistogramBinarizer,
} from "@zxing/library";
import { CameraOff, Loader2, Image as ImageIcon, Keyboard } from "lucide-react";

interface BarcodeScannerProps {
    onScan: (barcode: string) => void;
    onError?: (error: string) => void;
    /** Called when the user wants to add a product by hand (no barcode). */
    onManual?: () => void;
}

// Restrict to the retail/grocery 1D formats. Fewer formats = faster, more
// reliable decoding (the engine isn't hunting for QR/PDF417/etc every frame).
const RETAIL_FORMATS = [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
];

function makeReader() {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

// ── Robust image-file decode ──────────────────────────────────────────────────
// Real-world barcode photos are often rotated, over-large, or shot from an
// angle. A single decode pass misses most of those. We try multiple scales and
// rotations with both binarizers before giving up.

function makeCoreReader(): MultiFormatReader {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const r = new MultiFormatReader();
    r.setHints(hints);
    return r;
}

function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("No 2d context")); return; }
            ctx.drawImage(img, 0, 0);
            resolve(canvas);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
        img.src = url;
    });
}

function transformCanvas(
    src: HTMLCanvasElement,
    scale: number,
    rotDeg: 0 | 90 | 180 | 270,
): HTMLCanvasElement {
    const sw = Math.max(1, Math.round(src.width * scale));
    const sh = Math.max(1, Math.round(src.height * scale));
    const swapped = rotDeg === 90 || rotDeg === 270;
    const out = document.createElement("canvas");
    out.width = swapped ? sh : sw;
    out.height = swapped ? sw : sh;
    const ctx = out.getContext("2d")!;
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((rotDeg * Math.PI) / 180);
    ctx.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    return out;
}

function tryDecodeCanvas(reader: MultiFormatReader, canvas: HTMLCanvasElement): string | null {
    for (const Bin of [HybridBinarizer, GlobalHistogramBinarizer] as const) {
        try {
            const src = new HTMLCanvasElementLuminanceSource(canvas);
            const bitmap = new BinaryBitmap(new Bin(src));
            return reader.decodeWithState(bitmap).getText().trim();
        } catch { /* try next */ }
    }
    return null;
}

async function decodeImageFile(file: File): Promise<string | null> {
    const source = await loadImageToCanvas(file);
    const reader = makeCoreReader();
    const long = Math.max(source.width, source.height);

    // Scales: prefer ~1000px (fast + good binarization), also try 1600px
    // and raw 1× in case fine detail or full-res matters.
    const scales = Array.from(new Set([
        long > 1000 ? 1000 / long : 1,
        long > 1600 ? 1600 / long : 1,
        1,
    ]));

    for (const scale of scales) {
        for (const rot of [0, 90, 180, 270] as const) {
            const text = tryDecodeCanvas(reader, transformCanvas(source, scale, rot));
            if (text) return text;
        }
    }
    return null;
}

export default function BarcodeScanner({ onScan, onError, onManual }: BarcodeScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const controlsRef = useRef<IScannerControls | null>(null);
    const handledRef = useRef(false);

    const [cameraError, setCameraError] = useState(false);
    const [starting, setStarting] = useState(true);
    const [detected, setDetected] = useState(false);
    const [processingFile, setProcessingFile] = useState(false);

    useEffect(() => {
        const reader = makeReader();
        let cancelled = false;

        (async () => {
            try {
                const controls = await reader.decodeFromConstraints(
                    { video: { facingMode: { ideal: "environment" } } },
                    videoRef.current!,
                    (result) => {
                        if (result && !handledRef.current) {
                            handledRef.current = true;
                            setDetected(true);
                            controlsRef.current?.stop();
                            // Brief success flash, then hand off.
                            setTimeout(() => onScan(result.getText().trim()), 250);
                        }
                    },
                );
                // If a barcode was decoded before this promise resolved the
                // callback's controlsRef.current?.stop() was a no-op (ref still
                // null). Stop here instead to cover that race.
                if (cancelled || handledRef.current) {
                    controls.stop();
                    return;
                }
                controlsRef.current = controls;
                setStarting(false);
            } catch (err: any) {
                console.error("Camera init failed:", err);
                setCameraError(true);
                setStarting(false);
                onError?.("Camera unavailable. Upload a photo or add the item manually.");
            }
        })();

        return () => {
            cancelled = true;
            controlsRef.current?.stop();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setProcessingFile(true);
        try {
            const text = await decodeImageFile(file);
            if (text) {
                handledRef.current = true;
                controlsRef.current?.stop();
                onScan(text);
                return;
            }
            onError?.("No barcode found in that image. Add the item manually.");
            onManual?.();
        } catch (err) {
            console.error("Image decode error:", err);
            onError?.("Couldn't read that image. Add the item manually.");
            onManual?.();
        } finally {
            setProcessingFile(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="relative w-full h-full rounded-2xl overflow-hidden bg-black">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
            />

            {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-white p-8 text-center">
                    <CameraOff className="w-14 h-14 mb-4 text-zinc-500" />
                    <h3 className="text-lg font-semibold mb-1">Camera unavailable</h3>
                    <p className="text-zinc-400 max-w-xs mb-6 text-sm">
                        Upload a barcode photo, or add the product by hand — nothing gets stuck.
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="bg-white text-zinc-900 px-5 py-2.5 rounded-full font-semibold flex items-center gap-2"
                        >
                            <ImageIcon className="w-4 h-4" /> Upload photo
                        </button>
                        {onManual && (
                            <button
                                onClick={onManual}
                                className="bg-zinc-700 text-white px-5 py-2.5 rounded-full font-semibold flex items-center gap-2"
                            >
                                <Keyboard className="w-4 h-4" /> Manual
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <>
                    <video
                        ref={videoRef}
                        muted
                        playsInline
                        className="w-full h-full object-cover"
                    />

                    {/* Scan frame */}
                    <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-0 bg-black/30" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-44">
                            <div className={`relative w-full h-full rounded-xl border-2 transition-colors ${detected ? "border-emerald-400" : "border-white/70"}`}>
                                <span className="absolute -top-1 -left-1 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                <span className="absolute -top-1 -right-1 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                <span className="absolute -bottom-1 -left-1 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                <span className="absolute -bottom-1 -right-1 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                {!detected && (
                                    <div className="absolute left-0 right-0 h-0.5 bg-emerald-400/90 shadow-[0_0_12px_2px] shadow-emerald-400/70 animate-scanline" />
                                )}
                                {detected && <div className="absolute inset-0 bg-emerald-400/20 rounded-xl animate-pulse" />}
                            </div>
                        </div>
                    </div>

                    {/* Status + actions */}
                    <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-4 px-4">
                        <div className="bg-black/70 backdrop-blur px-5 py-2.5 rounded-full text-white text-sm font-medium flex items-center gap-2">
                            {starting ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Starting camera…</>
                            ) : detected ? (
                                <span className="text-emerald-300">Barcode detected ✓</span>
                            ) : (
                                "Point the camera at a barcode"
                            )}
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={processingFile}
                                className="bg-white/95 text-zinc-900 px-5 py-2.5 rounded-full font-semibold shadow-lg flex items-center gap-2 disabled:opacity-60"
                            >
                                {processingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                                Upload photo
                            </button>
                            {onManual && (
                                <button
                                    onClick={onManual}
                                    className="bg-black/60 text-white px-5 py-2.5 rounded-full font-semibold shadow-lg flex items-center gap-2 backdrop-blur"
                                >
                                    <Keyboard className="w-4 h-4" /> Enter manually
                                </button>
                            )}
                        </div>
                    </div>
                </>
            )}

            <style jsx global>{`
                @keyframes scanline {
                    0% { top: 4%; }
                    50% { top: 92%; }
                    100% { top: 4%; }
                }
                .animate-scanline { animation: scanline 2.4s ease-in-out infinite; }
            `}</style>
        </div>
    );
}

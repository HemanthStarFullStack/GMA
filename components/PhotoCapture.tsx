"use client";

import { useEffect, useRef, useState } from "react";
import { CameraOff, Loader2, Image as ImageIcon, Keyboard, Camera } from "lucide-react";

interface PhotoCaptureProps {
    /** Called with a JPEG blob of the captured/selected product photo. */
    onCapture: (image: Blob) => void;
    /** Called when the user wants to type details by hand. */
    onManual?: () => void;
    onError?: (error: string) => void;
}

// Cap the long edge so OCR stays fast, but keep it high enough that label text
// is sharp. A full-res phone still (12MP) downscaled to 1600 is crisp; the VLM
// reads it well without paying for megapixels of prefill it can't use.
const MAX_EDGE = 1600;

// Resize any image source to a JPEG no larger than MAX_EDGE on the long edge.
async function srcToJpeg(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.9));
}

// Grab the sharpest still the device can give. ImageCapture.takePhoto() pulls a
// FULL-resolution frame straight off the camera sensor (Chrome/Android) — far
// sharper than the ~720p getUserMedia *video* frame, which is what made captures
// look low-res. Falls back to a canvas grab of the video where unsupported.
async function captureStill(video: HTMLVideoElement, stream: MediaStream | null): Promise<Blob | null> {
    const track = stream?.getVideoTracks?.()[0];
    try {
        if (track && "ImageCapture" in window) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const photo: Blob = await new (window as any).ImageCapture(track).takePhoto();
            const bmp = await createImageBitmap(photo);
            return await srcToJpeg(bmp, bmp.width, bmp.height);
        }
    } catch { /* takePhoto unsupported/failed — use the video frame */ }
    return srcToJpeg(video, video.videoWidth || 1280, video.videoHeight || 720);
}

export default function PhotoCapture({ onCapture, onManual, onError }: PhotoCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [cameraError, setCameraError] = useState(false);
    const [starting, setStarting] = useState(true);
    const [capturing, setCapturing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    // Ask for a high-res rear stream — without this browsers hand
                    // back ~480p, which is why the preview and capture looked
                    // blurry. The camera caps to its real max if 1080p is too high.
                    video: {
                        facingMode: { ideal: "environment" },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                // Best-effort continuous autofocus so close-up label text is sharp.
                // Unsupported on many webcams/desktops — ignore if it throws.
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as any);
                } catch { /* device doesn't expose focusMode */ }
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    await videoRef.current.play().catch(() => {});
                }
                setStarting(false);
            } catch (err) {
                console.error("Camera init failed:", err);
                setCameraError(true);
                setStarting(false);
                onError?.("Camera unavailable. Upload a photo or add the item manually.");
            }
        })();

        return () => {
            cancelled = true;
            streamRef.current?.getTracks().forEach((t) => t.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const capture = async () => {
        if (!videoRef.current || capturing) return;
        setCapturing(true);
        try {
            const blob = await captureStill(videoRef.current, streamRef.current);
            if (blob) onCapture(blob);
            else onError?.("Couldn't capture the photo. Try again.");
        } finally {
            setCapturing(false);
        }
    };

    const onFile = async (file?: File) => {
        if (!file) return;
        // Try createImageBitmap first (fast path). Falls back to an <img> element
        // for HEIC/HEIF on desktop Chrome, which can't decode them directly but
        // can display them via <img> → canvas → JPEG conversion.
        try {
            const bmp = await createImageBitmap(file);
            const blob = await srcToJpeg(bmp, bmp.width, bmp.height);
            if (blob) { onCapture(blob); return; }
        } catch { /* fall through to img-element path */ }
        // img-element path: browser can display what createImageBitmap can't decode
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise<HTMLImageElement>((res, rej) => {
                const el = new Image();
                el.onload = () => res(el);
                el.onerror = rej;
                el.src = url;
            });
            const blob = await srcToJpeg(img, img.naturalWidth, img.naturalHeight);
            if (blob) { onCapture(blob); return; }
        } catch { /* nothing left to try */ } finally {
            URL.revokeObjectURL(url);
        }
        onError?.("This image format isn't supported. Try taking a photo directly.");
    };

    return (
        <div className="absolute inset-0 bg-black">
            {!cameraError && (
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            )}

            {starting && !cameraError && (
                <div className="absolute inset-0 flex items-center justify-center text-white/80">
                    <Loader2 className="w-8 h-8 animate-spin" />
                </div>
            )}

            {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/80 px-6 text-center">
                    <CameraOff className="w-10 h-10 mb-3" />
                    <p className="text-sm">Camera unavailable. Upload a photo instead.</p>
                </div>
            )}

            {/* Framing hint */}
            {!cameraError && !starting && (
                <div className="absolute inset-0 flex items-start justify-center pointer-events-none">
                    <p className="mt-4 text-white/90 text-sm bg-black/40 px-3 py-1.5 rounded-full">
                        Fill the frame with the product front
                    </p>
                </div>
            )}

            {/* Controls */}
            <div className="absolute bottom-0 inset-x-0 p-4 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent">
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center gap-1 text-white/90 text-xs"
                >
                    <ImageIcon className="w-6 h-6" />
                    Upload
                </button>

                <button
                    type="button"
                    onClick={capture}
                    disabled={starting || cameraError || capturing}
                    aria-label="Capture photo"
                    className="w-16 h-16 rounded-full bg-white ring-4 ring-white/40 flex items-center justify-center disabled:opacity-40"
                >
                    {capturing ? <Loader2 className="w-7 h-7 animate-spin text-ink" /> : <Camera className="w-7 h-7 text-ink" />}
                </button>

                <button
                    type="button"
                    onClick={() => onManual?.()}
                    className="flex flex-col items-center gap-1 text-white/90 text-xs"
                >
                    <Keyboard className="w-6 h-6" />
                    Manual
                </button>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
            />
        </div>
    );
}

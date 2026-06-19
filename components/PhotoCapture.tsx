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

// Downscale the captured frame so uploads stay small and OCR stays fast. A
// product label is legible well under 1600px on the long edge.
const MAX_EDGE = 1600;

function frameToBlob(video: HTMLVideoElement): Promise<Blob | null> {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
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
                    video: { facingMode: { ideal: "environment" } },
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
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
            const blob = await frameToBlob(videoRef.current);
            if (blob) onCapture(blob);
            else onError?.("Couldn't capture the photo. Try again.");
        } finally {
            setCapturing(false);
        }
    };

    const onFile = (file?: File) => {
        if (file) onCapture(file);
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

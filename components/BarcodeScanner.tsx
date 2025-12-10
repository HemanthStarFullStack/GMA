"use client";

import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
import { Camera, CameraOff, Loader2, Upload, Image } from "lucide-react";

interface BarcodeScannerProps {
    onScan: (barcode: string) => void;
    onError?: (error: string) => void;
    onCapture?: (imageSrc: string) => void;
}

export default function BarcodeScanner({ onScan, onError, onCapture }: BarcodeScannerProps) {
    const webcamRef = useRef<Webcam>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isScanning, setIsScanning] = useState(true);
    const [cameraError, setCameraError] = useState(false);
    const [lastScanned, setLastScanned] = useState("");
    const [scanIndicator, setScanIndicator] = useState(false);
    const [isProcessingFile, setIsProcessingFile] = useState(false);

    useEffect(() => {
        if (!isScanning || !webcamRef.current) return;

        const codeReader = new BrowserMultiFormatReader();
        let scanning = true;

        const scan = async () => {
            while (scanning && webcamRef.current?.video) {
                try {
                    // Take a snapshot from the video instead of decoding video directly
                    const imageSrc = webcamRef.current.getScreenshot();

                    if (imageSrc) {
                        // Create image element from snapshot
                        const img = document.createElement('img');
                        img.src = imageSrc;

                        await new Promise((resolve) => {
                            img.onload = resolve;
                        });

                        // Decode from the snapshot (same as upload)
                        const result = await codeReader.decodeFromImageElement(img);

                        if (result) {
                            console.log('✅ Barcode detected:', result.getText()); // DEBUG
                            if (result.getText() !== lastScanned) {
                                const barcode = result.getText();
                                setLastScanned(barcode);
                                setScanIndicator(true);
                                setIsScanning(false); // Stop scanning after detection
                                onScan(barcode);

                                // Reset indicator after animation
                                setTimeout(() => setScanIndicator(false), 500);

                                // Exit the scanning loop immediately
                                scanning = false;
                                break;
                            }
                        }
                    }
                } catch (err) {
                    if (!(err instanceof NotFoundException)) {
                        console.error("Scan error:", err);
                    } else {
                        // This is normal - no barcode detected in this frame
                    }
                }

                // Delay between snapshots (scan ~2 times per second)
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        };

        scan();

        return () => {
            scanning = false;
            codeReader.reset();
        };
    }, [isScanning, onScan]);

    const handleUserMediaError = () => {
        setCameraError(true);
        onError?.("Camera access denied. Please enable camera permissions.");
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsProcessingFile(true);
        try {
            const codeReader = new BrowserMultiFormatReader();
            const imageUrl = URL.createObjectURL(file);

            // Create an image element to decode
            const img = document.createElement('img');
            img.src = imageUrl;

            await new Promise((resolve) => {
                img.onload = resolve;
            });

            // 1. Try to decode barcode
            try {
                const result = await codeReader.decodeFromImageElement(img);
                if (result) {
                    const barcode = result.getText();
                    setLastScanned(barcode);
                    setScanIndicator(true);
                    onScan(barcode);
                    setTimeout(() => setScanIndicator(false), 500);
                    return; // Success! Be sure to return.
                }
            } catch (decodeErr) {
                // ZXing failed to find barcode. proceed to fallback.
                console.log("Barcode decode failed, falling back to AI:", decodeErr);
            }

            // 2. Fallback: If no barcode found, send to AI (onCapture)
            if (onCapture) {
                // Convert to base64 for AI processing
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64String = reader.result as string;
                    onCapture(base64String); // Trigger AI flow in parent
                };
                reader.readAsDataURL(file);
            } else {
                onError?.("No barcode found and AI capture not available.");
            }

            URL.revokeObjectURL(imageUrl);
        } catch (err) {
            console.error("File processing error:", err);
            onError?.("Failed to process image.");
        } finally {
            setIsProcessingFile(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="relative w-full h-full rounded-xl overflow-hidden bg-black">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileUpload}
                className="hidden"
            />

            {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white p-8">
                    <CameraOff className="w-16 h-16 mb-4 text-gray-400" />
                    <h3 className="text-xl font-semibold mb-2">Camera Access Denied</h3>
                    <p className="text-gray-400 text-center max-w-md mb-6">
                        Camera access is restricted on this device. You can still scan barcodes by uploading an image instead.
                    </p>
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessingFile}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isProcessingFile ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Upload className="w-5 h-5" />
                                Upload Barcode Image
                            </>
                        )}
                    </button>
                </div>
            ) : (
                <>
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{
                            facingMode: "environment",
                            width: { ideal: 1920 },
                            height: { ideal: 1080 },
                        }}
                        onUserMediaError={handleUserMediaError}
                        className="w-full h-full object-cover"
                    />

                    {/* Scan frame overlay */}
                    <div className="absolute inset-0 pointer-events-none">
                        {/* Darkened corners */}
                        <div className="absolute inset-0 bg-black/40" />

                        {/* Center scan frame */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-48">
                            {/* Scan frame */}
                            <div className="relative w-full h-full border-2 border-white rounded-lg">
                                {/* Corner accents */}
                                <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
                                <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
                                <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
                                <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />

                                {/* Scanning line animation */}
                                {isScanning && (
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-scan" />
                                )}

                                {/* Success indicator */}
                                {scanIndicator && (
                                    <div className="absolute inset-0 bg-green-500/30 animate-pulse" />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center pointer-events-none">
                        <div className="bg-black/70 backdrop-blur-sm px-6 py-3 rounded-full mb-4">
                            <div className="flex items-center gap-2 text-white">
                                {isScanning ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm font-medium">Scanning for barcodes...</span>
                                    </>
                                ) : lastScanned ? (
                                    <>
                                        <Camera className="w-4 h-4 text-green-400" />
                                        <span className="text-sm font-medium">Barcode detected! Click below to scan another</span>
                                    </>
                                ) : (
                                    <>
                                        <Camera className="w-4 h-4" />
                                        <span className="text-sm font-medium">Point camera at barcode</span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-3 pointer-events-auto">{!isScanning && lastScanned && (
                            <button
                                onClick={() => {
                                    setLastScanned("");
                                    setIsScanning(true);
                                }}
                                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-full font-semibold shadow-lg transition-colors flex items-center gap-2"
                            >
                                <Camera className="w-5 h-5" />
                                Scan Another
                            </button>
                        )}
                            {onCapture && (
                                <button
                                    onClick={() => {
                                        const imageSrc = webcamRef.current?.getScreenshot();
                                        if (imageSrc) onCapture(imageSrc);
                                    }}
                                    className="bg-white text-gray-900 px-6 py-3 rounded-full font-semibold shadow-lg hover:bg-gray-100 transition-colors flex items-center gap-2"
                                >
                                    <Camera className="w-5 h-5" />
                                    Take Photo (AI Identify)
                                </button>
                            )}

                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isProcessingFile}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-full font-semibold shadow-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isProcessingFile ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Image className="w-5 h-5" />
                                        Upload Image
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </>
            )}

            <style jsx global>{`
        @keyframes scan {
          0% {
            transform: translateY(0);
          }
          100% {
            transform: translateY(192px);
          }
        }
        .animate-scan {
          animation: scan 2s ease-in-out infinite;
        }
      `}</style>
        </div>
    );
}

"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import { ArrowLeft, Sparkles, Upload, Camera as CameraIcon } from "lucide-react";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";

export default function ScanPage() {
    const router = useRouter();
    const [scannedCode, setScannedCode] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [uploadMode, setUploadMode] = useState(false);
    const [showNotFound, setShowNotFound] = useState(false);
    const [failedBarcode, setFailedBarcode] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processWithAI = async (imageSrc: string) => {
        setIsProcessing(true);

        try {
            const res = await fetch('/api/ai-identify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageSrc })
            });

            const data = await res.json();

            if (data.success) {
                const aiProduct = data.data;

                const addRes = await fetch('/api/inventory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        productId: `AI-${Date.now()}`,
                        quantity: 1,
                        unit: aiProduct.defaultUnit || 'units',
                        productDetails: {
                            name: aiProduct.name,
                            brand: aiProduct.brand,
                            flavor: aiProduct.flavor,
                            category: aiProduct.category,
                            imageUrl: aiProduct.imageUrl,
                            addedBy: 'ai',
                            confidence: aiProduct.confidence
                        }
                    })
                });

                if (addRes.ok) {
                    setScannedCode(`AI Identified: ${aiProduct.name} by ${aiProduct.brand}`);
                    setTimeout(() => router.push('/inventory'), 2000);
                } else {
                    alert('Failed to add item to inventory');
                    setIsProcessing(false);
                }
            } else {
                alert('AI could not identify the product. Please try again.');
                setIsProcessing(false);
            }
        } catch (error) {
            console.error('AI processing error:', error);
            alert('Error processing image. Please try again.');
            setIsProcessing(false);
        }
    };

    const handleCapture = async (imageSrc: string) => {
        if (isProcessing) return;
        await processWithAI(imageSrc);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || isProcessing) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file');
            return;
        }

        // Convert to base64
        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64Image = e.target?.result as string;
            await processWithAI(base64Image);
        };
        reader.readAsDataURL(file);

        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleManualAdd = async (barcode: string) => {
        // Fallback logic: Add as generic item
        try {
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    productId: barcode,
                    quantity: 1,
                    unit: 'units',
                    productDetails: {
                        name: 'Unknown Product',
                        brand: 'Unknown',
                        category: 'Other',
                        addedBy: 'manual'
                    }
                })
            });

            if (res.ok) {
                router.push('/inventory');
            } else {
                alert('Failed to add item');
            }
        } catch (e) {
            console.error('Manual add error', e);
        }
    };

    const handleScan = async (barcode: string) => {
        if (isProcessing) return;

        setScannedCode(barcode);
        setIsProcessing(true);

        try {
            // 1. Lookup Barcode
            const lookupRes = await fetch(`/api/barcode?barcode=${barcode}`);
            const lookupData = await lookupRes.json();

            let productData = {
                productId: barcode,
                quantity: 1,
                unit: 'units',
                productDetails: null as any
            };

            if (lookupData.success) {
                // Found product!
                const item = lookupData.data;
                setScannedCode(`✓ ${item.name} (${lookupData.source})`);
                productData.productDetails = item;

                // Add to inventory
                const res = await fetch('/api/inventory', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(productData)
                });

                if (res.ok) {
                    setTimeout(() => {
                        router.push('/inventory');
                    }, 1500);
                } else {
                    alert('Failed to add item to inventory');
                    setIsProcessing(false);
                }

            } else {
                // Not found in ANY provider
                console.log('Product not found in any database');
                setFailedBarcode(barcode);
                setShowNotFound(true);
                // Do NOT auto-add. Let user decide in dialog.
            }

        } catch (error) {
            console.error('Scan error:', error);
            alert('Error processing barcode');
            setIsProcessing(false);
        }
    };

    const handleError = (error: string) => {
        console.error("Scanner error:", error);
    };

    return (
        <div className="min-h-screen bg-gray-900">
            {/* Header */}
            <div className="bg-gray-800 border-b border-gray-700">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-white hover:text-gray-300">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="text-xl font-bold text-white">Scan Product</h1>
                    <div className="flex justify-end min-w-[3rem]">
                        <UserMenu />
                    </div>
                </div>
            </div>

            {/* Mode Toggle */}
            <div className="bg-gray-800 border-b border-gray-700">
                <div className="container mx-auto px-4 py-3">
                    <div className="max-w-2xl mx-auto flex gap-2">
                        <button
                            onClick={() => setUploadMode(false)}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${!uploadMode
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            <div className="flex items-center justify-center gap-2">
                                <CameraIcon className="w-4 h-4" />
                                <span>Camera Scan</span>
                            </div>
                        </button>
                        <button
                            onClick={() => setUploadMode(true)}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${uploadMode
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                        >
                            <div className="flex items-center justify-center gap-2">
                                <Upload className="w-4 h-4" />
                                <span>Upload Image</span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>

            {/* Scanner / Upload */}
            <div className="container mx-auto px-4 py-6">
                <div className="max-w-2xl mx-auto">
                    {!uploadMode ? (
                        <>
                            {/* Camera Scanner */}
                            <div className="aspect-video w-full mb-6">
                                <BarcodeScanner
                                    onScan={handleScan}
                                    onError={handleError}
                                    onCapture={handleCapture}
                                />
                            </div>
                        </>
                    ) : (
                        <>
                            {/* Image Upload */}
                            <div className="aspect-video w-full mb-6 bg-gray-800 rounded-xl border-2 border-dashed border-gray-600 flex items-center justify-center">
                                <div className="text-center p-8">
                                    <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                    <h3 className="text-lg font-semibold text-white mb-2">
                                        Upload Product Image
                                    </h3>
                                    <p className="text-gray-400 mb-6 text-sm">
                                        Upload a clear photo of the product for AI identification
                                    </p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                        disabled={isProcessing}
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isProcessing}
                                        className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isProcessing ? 'Processing...' : 'Choose Image'}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Scan Result */}
                    {scannedCode && (
                        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                    <Sparkles className="w-6 h-6 text-green-600" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                        {isProcessing ? "Processing..." : "Product Detected!"}
                                    </h3>
                                    <p className="text-gray-600 text-sm">{scannedCode}</p>
                                    {isProcessing && (
                                        <p className="text-sm text-purple-600 mt-2">
                                            Adding to inventory...
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Not Found Dialog */}
                    {showNotFound && (
                        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
                            <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full border border-gray-700 shadow-2xl">
                                <div className="flex items-start gap-4 mb-4">
                                    <div className="bg-yellow-500/20 p-2 rounded-full">
                                        <Sparkles className="w-6 h-6 text-yellow-500" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-white">Product Not Found</h3>
                                        <p className="text-gray-400 text-sm mt-1">
                                            We couldn't find details for barcode <span className="font-mono text-yellow-400">{failedBarcode}</span>.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <button
                                        onClick={() => {
                                            setShowNotFound(false);
                                            setUploadMode(true);
                                        }}
                                        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <CameraIcon className="w-5 h-5" />
                                        Identify with AI Camera
                                    </button>

                                    <div className="relative">
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full border-t border-gray-600"></div>
                                        </div>
                                        <div className="relative flex justify-center text-xs uppercase">
                                            <span className="bg-gray-800 px-2 text-gray-500">Or</span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setShowNotFound(false);
                                            // Fallback to manual entry (just store generic known barcode)
                                            // Ideally forward to an edit page, but for now just saving as "Unknown" is the backup
                                            handleManualAdd(failedBarcode || '');
                                        }}
                                        className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium text-sm transition-colors"
                                    >
                                        Add as Unknown Item
                                    </button>

                                    <button
                                        onClick={() => {
                                            setShowNotFound(false);
                                            setIsProcessing(false);
                                            setScannedCode(null);
                                        }}
                                        className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Instructions */}
                    <div className="bg-blue-900/40 border border-blue-800 rounded-xl p-6 mt-6">
                        <h3 className="font-semibold text-blue-100 mb-2 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-blue-400" />
                            {uploadMode ? 'AI Camera Tips:' : 'Fast Scanning:'}
                        </h3>
                        {uploadMode ? (
                            <ul className="space-y-2 text-sm text-blue-200/80">
                                <li>• Photo of branding/packaging works best</li>
                                <li>• Ensure good lighting</li>
                                <li>• AI will extract Name, Brand & Flavor</li>
                            </ul>
                        ) : (
                            <ul className="space-y-2 text-sm text-blue-200/80">
                                <li>• Point camera at barcode</li>
                                <li>• If not found, use AI Camera fallback</li>
                                <li>• Works with UPC, EAN & most formats</li>
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

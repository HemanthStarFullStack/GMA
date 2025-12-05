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

    const handleScan = async (barcode: string) => {
        if (isProcessing) return;

        setScannedCode(barcode);
        setIsProcessing(true);

        try {
            // 1. First, try to lookup the barcode using UPCitemDB
            const lookupRes = await fetch(`/api/barcode?barcode=${barcode}`);
            const lookupData = await lookupRes.json();

            let productData = {
                productId: barcode,
                quantity: 1,
                unit: 'units',
                productDetails: null as any
            };

            if (lookupData.success) {
                // Found product in UPCitemDB!
                setScannedCode(`✓ ${lookupData.data.name} by ${lookupData.data.brand}`);
                productData.productDetails = lookupData.data;
            } else if (lookupData.code === 'NOT_FOUND') {
                // Product not found in UPCitemDB - this is expected for many products
                console.log('Product not in UPCitemDB database, adding with basic info');
                setScannedCode(`Barcode: ${barcode} (Unknown product)`);
            } else if (lookupData.code === 'RATE_LIMIT_EXCEEDED') {
                // Hit daily limit (100 requests)
                alert('Daily barcode lookup limit reached. Product will be added with barcode only.');
                setScannedCode(`Barcode: ${barcode} (Limit reached)`);
            } else {
                console.warn('UPCitemDB lookup failed:', lookupData.message);
            }

            // 2. Add to inventory (with or without product details)
            const res = await fetch('/api/inventory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(productData)
            });

            const data = await res.json();

            if (data.success) {
                setTimeout(() => {
                    router.push('/inventory');
                }, 2000); // Slightly longer delay to show the product name
            } else {
                console.error('Failed to add item:', data.message);
                alert('Failed to add item to inventory');
                setIsProcessing(false);
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

                    {/* Instructions */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                        <h3 className="font-semibold text-blue-900 mb-2">
                            {uploadMode ? 'Upload Tips:' : 'How to scan:'}
                        </h3>
                        {uploadMode ? (
                            <ul className="space-y-2 text-sm text-blue-800">
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">1.</span>
                                    <span>Take a clear photo of the product</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">2.</span>
                                    <span>Ensure good lighting and product is visible</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">3.</span>
                                    <span>Click "Choose Image" and select the photo</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">4.</span>
                                    <span>AI will identify the product and add it to inventory</span>
                                </li>
                            </ul>
                        ) : (
                            <ul className="space-y-2 text-sm text-blue-800">
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">1.</span>
                                    <span>Point your camera at the product barcode</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">2.</span>
                                    <span>Keep the barcode within the scanning frame</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">3.</span>
                                    <span>Hold steady until the scan is detected</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="text-blue-600 font-bold">4.</span>
                                    <span>Or click "Take Photo" to use AI identification</span>
                                </li>
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

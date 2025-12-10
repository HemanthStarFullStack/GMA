"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Package, Clock, TrendingDown, Check, X } from "lucide-react";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";

interface Product {
    productId: string;
    name: string;
    brand: string;
    category: string;
    imageUrl?: string;
    status: 'in_stock' | 'out_of_stock';
    currentStock: number;
    unit: string;
    purchaseDate: string | null;
    consumptionHistory: {
        totalConsumed: number;
        timesConsumed: number;
        averageDurationDays: number;
        lastConsumed: string | null;
    };
    predictions: {
        consumptionRate: number;
        daysUntilEmpty: number;
        restockDate: string;
        needsRestock: boolean;
    } | null;
}

export default function AnalyticsPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadAnalytics();
    }, []);

    const loadAnalytics = async () => {
        try {
            const res = await fetch('/api/analytics');
            const json = await res.json();
            if (json.success) {
                setProducts(json.data.products || []);
                if (json.data.products && json.data.products.length > 0) {
                    setSelectedProduct(json.data.products[0]);
                }
            }
        } catch (error) {
            console.error('Failed to load analytics:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-900">
            {/* Header */}
            <div className="bg-gray-800 border-b border-gray-700">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-white hover:text-gray-300">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="text-xl font-bold text-white">Product Analytics</h1>
                    <div className="flex justify-end min-w-[3rem]">
                        <UserMenu />
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-6">
                {products.length === 0 ? (
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
                        <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-400 mb-2">No Products Yet</h3>
                        <p className="text-gray-500">Scan some products to see analytics</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Product List - Left Panel */}
                        <div className="lg:col-span-1">
                            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 sticky top-4">
                                <h2 className="text-lg font-bold text-white mb-4">
                                    All Products ({products.length})
                                </h2>
                                <div className="space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto">
                                    {products.map((product) => (
                                        <div
                                            key={product.productId}
                                            onClick={() => setSelectedProduct(product)}
                                            className={`p-3 rounded-lg cursor-pointer transition-all ${selectedProduct?.productId === product.productId
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                                                }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                {product.imageUrl && (
                                                    <img
                                                        src={product.imageUrl}
                                                        alt={product.name}
                                                        className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                                                    />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-semibold truncate text-sm">{product.name}</h3>
                                                    <p className="text-xs opacity-75 truncate">{product.brand}</p>
                                                </div>
                                                {product.status === 'in_stock' ? (
                                                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                                                ) : (
                                                    <X className="w-4 h-4 text-red-400 flex-shrink-0" />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Product Details - Right Panel */}
                        {selectedProduct && (
                            <div className="lg:col-span-2">
                                <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
                                    {/* Header */}
                                    <div className="flex items-start gap-6 mb-6">
                                        {selectedProduct.imageUrl && (
                                            <img
                                                src={selectedProduct.imageUrl}
                                                alt={selectedProduct.name}
                                                className="w-24 h-24 object-cover rounded-xl flex-shrink-0"
                                            />
                                        )}
                                        <div className="flex-1">
                                            <h2 className="text-2xl font-bold text-white mb-1">{selectedProduct.name}</h2>
                                            <p className="text-lg text-gray-400 mb-2">{selectedProduct.brand}</p>
                                            <div className="flex gap-2">
                                                <span className="text-xs text-gray-500 bg-gray-700 px-2 py-1 rounded-full">
                                                    {selectedProduct.category}
                                                </span>
                                                <span className={`text-xs px-2 py-1 rounded-full ${selectedProduct.status === 'in_stock'
                                                        ? 'bg-green-500/20 text-green-400'
                                                        : 'bg-red-500/20 text-red-400'
                                                    }`}>
                                                    {selectedProduct.status === 'in_stock' ? 'In Stock' : 'Out of Stock'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Current Stock */}
                                    {selectedProduct.status === 'in_stock' && (
                                        <div className="mb-6 bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                                            <h3 className="text-sm font-semibold text-gray-400 mb-3">Current Stock</h3>
                                            <p className="text-3xl font-bold text-white">
                                                {selectedProduct.currentStock} {selectedProduct.unit}
                                            </p>
                                        </div>
                                    )}

                                    {/* Consumption History */}
                                    {selectedProduct.consumptionHistory.timesConsumed > 0 && (
                                        <div className="mb-6">
                                            <h3 className="text-sm font-semibold text-gray-400 mb-3">Consumption History</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                                                    <p className="text-xs text-gray-500 mb-1">Total Consumed</p>
                                                    <p className="text-2xl font-bold text-white">
                                                        {selectedProduct.consumptionHistory.totalConsumed}
                                                    </p>
                                                </div>
                                                <div className="bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                                                    <p className="text-xs text-gray-500 mb-1">Times Consumed</p>
                                                    <p className="text-2xl font-bold text-white">
                                                        {selectedProduct.consumptionHistory.timesConsumed}
                                                    </p>
                                                </div>
                                                <div className="bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                                                    <p className="text-xs text-gray-500 mb-1">Avg Duration</p>
                                                    <p className="text-2xl font-bold text-white">
                                                        {selectedProduct.consumptionHistory.averageDurationDays} days
                                                    </p>
                                                </div>
                                                <div className="bg-gray-700/30 rounded-xl p-4 border border-gray-600">
                                                    <p className="text-xs text-gray-500 mb-1">Last Consumed</p>
                                                    <p className="text-sm font-bold text-white">
                                                        {selectedProduct.consumptionHistory.lastConsumed
                                                            ? new Date(selectedProduct.consumptionHistory.lastConsumed).toLocaleDateString()
                                                            : 'N/A'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Predictions */}
                                    {selectedProduct.predictions && (
                                        <div>
                                            <h3 className="text-sm font-semibold text-gray-400 mb-3">Predictions</h3>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="bg-purple-500/10 rounded-xl p-4 border border-purple-500/30">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <TrendingDown className="w-4 h-4 text-purple-400" />
                                                        <p className="text-xs text-purple-300">Consumption Rate</p>
                                                    </div>
                                                    <p className="text-2xl font-bold text-white">
                                                        {selectedProduct.predictions.consumptionRate} {selectedProduct.unit}/day
                                                    </p>
                                                </div>
                                                <div className={`rounded-xl p-4 border ${selectedProduct.predictions.needsRestock
                                                        ? 'bg-red-500/10 border-red-500/30'
                                                        : 'bg-green-500/10 border-green-500/30'
                                                    }`}>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Clock className={`w-4 h-4 ${selectedProduct.predictions.needsRestock ? 'text-red-400' : 'text-green-400'
                                                            }`} />
                                                        <p className={`text-xs ${selectedProduct.predictions.needsRestock ? 'text-red-300' : 'text-green-300'
                                                            }`}>Days Until Empty</p>
                                                    </div>
                                                    <p className={`text-2xl font-bold ${selectedProduct.predictions.needsRestock ? 'text-red-400' : 'text-green-400'
                                                        }`}>
                                                        {selectedProduct.predictions.daysUntilEmpty} days
                                                    </p>
                                                </div>
                                                <div className="col-span-2 bg-orange-500/10 rounded-xl p-4 border border-orange-500/30">
                                                    <p className="text-xs text-orange-300 mb-1">Estimated Restock Date</p>
                                                    <p className="text-xl font-bold text-white">
                                                        {new Date(selectedProduct.predictions.restockDate).toLocaleDateString('en-US', {
                                                            weekday: 'short',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        })}
                                                    </p>
                                                </div>
                                            </div>

                                            {selectedProduct.predictions.needsRestock && (
                                                <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                                                    <p className="text-sm text-red-300">
                                                        ⚠️ <strong>Restock Alert:</strong> This product will run out in less than 7 days!
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* No Data Message */}
                                    {selectedProduct.consumptionHistory.timesConsumed === 0 && !selectedProduct.predictions && (
                                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6 text-center">
                                            <p className="text-blue-300">
                                                No consumption history available yet. Mark this product as consumed to see analytics!
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

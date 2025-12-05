"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2 } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import ProductSurvey from "@/components/ProductSurvey";
import UserMenu from "@/components/UserMenu";

interface InventoryItem {
    _id: string;
    userId: string;
    productId: string;
    quantity: number;
    unit: string;
    purchaseDate: string;
    product: {
        name: string;
        brand: string;
        imageUrl: string | null;
        flavor?: string;
    };
}

export default function InventoryPage() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [surveyOpen, setSurveyOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

    useEffect(() => {
        fetchInventory();
    }, []);

    const fetchInventory = async () => {
        try {
            const res = await fetch('/api/inventory');
            const data = await res.json();
            if (data.success) {
                setItems(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch inventory:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleConsume = async (id: string) => {
        // Find the item to trigger the survey
        const item = items.find((i) => i._id === id);
        if (!item) return;

        setSelectedItem(item);
        setSurveyOpen(true);
    };

    const handleSurveySubmit = async (surveyData: { userReportedDays: number; notes?: string }) => {
        if (!selectedItem) return;

        try {
            const actualDays = Math.floor((new Date().getTime() - new Date(selectedItem.purchaseDate).getTime()) / (1000 * 3600 * 24));

            const res = await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: selectedItem.userId,
                    productId: selectedItem.productId,
                    inventoryId: selectedItem._id,
                    durationDays: actualDays,
                    surveyData: {
                        userReportedDays: surveyData.userReportedDays,
                        familySize: 1, // TODO: Get from user settings
                        flagged: Math.abs(surveyData.userReportedDays - 14) > 14 * 0.3, // TODO: Use actual average duration
                        notes: surveyData.notes || ""
                    }
                })
            });

            const data = await res.json();
            if (data.success) {
                fetchInventory();
                setSelectedItem(null);
            }
        } catch (error) {
            console.error('Failed to consume item:', error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this item?')) return;

        try {
            const res = await fetch(`/api/inventory?id=${id}`, {
                method: 'DELETE'
            });

            const data = await res.json();
            if (data.success) {
                fetchInventory();
            }
        } catch (error) {
            console.error('Failed to delete item:', error);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
                <div className="container mx-auto px-4 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="text-xl font-bold text-gray-900">My Inventory</h1>
                    <div className="flex items-center gap-4">
                        <Link
                            href="/scan"
                            className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl"
                        >
                            <Plus className="w-6 h-6" />
                        </Link>
                        <UserMenu />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="container mx-auto px-4 py-6">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Plus className="w-8 h-8 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No items yet</h3>
                        <p className="text-gray-500 mb-6">Scan your first product to get started!</p>
                        <Link
                            href="/scan"
                            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-full shadow-sm text-white bg-blue-600 hover:bg-blue-700"
                        >
                            Scan Product
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {items.map((item: any) => (
                            <ProductCard
                                key={item._id}
                                item={item}
                                onConsume={handleConsume}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Survey Modal */}
            {selectedItem && (
                <ProductSurvey
                    isOpen={surveyOpen}
                    onClose={() => {
                        setSurveyOpen(false);
                        setSelectedItem(null);
                    }}
                    productName={selectedItem.product.name}
                    expectedDays={14} // TODO: Get from product average duration
                    familySize={1} // TODO: Get from user settings
                    onSubmit={handleSurveySubmit}
                />
            )}
        </div>
    );
}

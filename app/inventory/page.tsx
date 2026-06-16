"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, BarChart3 } from "lucide-react";
import ProductCard from "@/components/ProductCard";
import ProductSurvey from "@/components/ProductSurvey";
import UserMenu from "@/components/UserMenu";
import Tour from "@/components/Tour";

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
        category?: string;
        averageDuration?: number;
    };
}

// Group the fine-grained scan categories into intuitive pantry shelves.
const SECTIONS: { title: string; cats: string[] }[] = [
    { title: "Staples", cats: ["Pantry", "Bakery"] },
    { title: "Fresh", cats: ["Fruits & Vegetables", "Dairy & Eggs", "Meat & Seafood"] },
    { title: "Snacks", cats: ["Snacks"] },
    { title: "Drinks", cats: ["Beverages"] },
    { title: "Frozen", cats: ["Frozen Foods"] },
    { title: "Condiments", cats: ["Condiments & Sauces"] },
    { title: "Household", cats: ["Cleaning & Household", "Personal Care"] },
];
const SECTION_ORDER = [...SECTIONS.map((s) => s.title), "Other"];

function sectionFor(category?: string): string {
    const c = (category || "Other").trim();
    return SECTIONS.find((s) => s.cats.includes(c))?.title ?? "Other";
}

export default function InventoryPage() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [familySize, setFamilySize] = useState(1);
    const [surveyOpen, setSurveyOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [runTour, setRunTour] = useState(false);

    useEffect(() => {
        (async () => {
            // First-login onboarding: server-guarded, so this is a no-op after the first time.
            try {
                await fetch("/api/demo", { method: "POST" });
            } catch {
                /* non-fatal */
            }
            await fetchInventory();
            try {
                const data = await (await fetch("/api/user")).json();
                if (data.success) {
                    setFamilySize(data.data.familySize ?? 1);
                    if (!data.data.tourCompleted) setRunTour(true);
                }
            } catch {
                /* keep defaults */
            }
            setLoading(false);
        })();
    }, []);

    // When the tour ends (finished or skipped): clear demo data, mark done, refresh to the empty account.
    const finishTour = useCallback(async () => {
        setRunTour(false);
        try {
            await fetch("/api/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tourCompleted: true }),
            });
            await fetch("/api/demo", { method: "DELETE" });
        } catch {
            /* non-fatal */
        }
        fetchInventory();
    }, []);

    const fetchInventory = async () => {
        try {
            const res = await fetch("/api/inventory");
            const data = await res.json();
            if (data.success) setItems(data.data);
        } catch (error) {
            console.error("Failed to fetch inventory:", error);
        }
    };

    const handleConsume = (id: string) => {
        const item = items.find((i) => i._id === id);
        if (!item) return;
        setSelectedItem(item);
        setSurveyOpen(true);
    };

    const handleSurveySubmit = async (surveyData: { userReportedDays: number; notes?: string }) => {
        if (!selectedItem) return;
        try {
            const actualDays = Math.max(
                1,
                Math.floor((Date.now() - new Date(selectedItem.purchaseDate).getTime()) / 86400000),
            );
            const expected = selectedItem.product.averageDuration || 14;

            const res = await fetch("/api/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId: selectedItem.productId,
                    inventoryId: selectedItem._id,
                    durationDays: surveyData.userReportedDays || actualDays,
                    surveyData: {
                        userReportedDays: surveyData.userReportedDays,
                        familySize,
                        flagged: Math.abs(surveyData.userReportedDays - expected) > expected * 0.3,
                        notes: surveyData.notes || "",
                    },
                }),
            });

            const data = await res.json();
            if (data.success) {
                setSurveyOpen(false);
                setSelectedItem(null);
                fetchInventory();
            }
        } catch (error) {
            console.error("Failed to log consumption:", error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this item?")) return;
        try {
            const res = await fetch(`/api/inventory?id=${id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) fetchInventory();
        } catch (error) {
            console.error("Failed to delete item:", error);
        }
    };

    return (
        <div className="min-h-screen">
            <header className="bg-paper/85 backdrop-blur border-b border-line sticky top-0 z-10">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-ink-soft hover:text-ink">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="font-display text-2xl font-semibold text-ink">Inventory</h1>
                    <div className="flex items-center gap-3">
                        <Link id="tour-analytics" href="/analytics" title="Analytics" className="w-10 h-10 rounded-full border border-line-strong flex items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors">
                            <BarChart3 className="w-5 h-5" />
                        </Link>
                        <Link id="tour-scan" href="/scan" className="btn-primary w-10 h-10 flex items-center justify-center shadow-lg">
                            <Plus className="w-6 h-6" />
                        </Link>
                        <UserMenu />
                    </div>
                </div>
            </header>

            <main className="container mx-auto px-5 py-8">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-terracotta" /></div>
                ) : items.length === 0 ? (
                    <div className="text-center py-16 rise">
                        <div className="w-16 h-16 bg-paper-2 border border-line rounded-full flex items-center justify-center mx-auto mb-4">
                            <Plus className="w-8 h-8 text-ink-faint" />
                        </div>
                        <h3 className="font-display text-2xl font-semibold text-ink mb-2">Your pantry is empty</h3>
                        <p className="text-ink-soft mb-6">Scan your first product to get started.</p>
                        <Link href="/scan" className="btn-primary inline-flex items-center px-6 py-3 text-base shadow-lg">
                            Scan a product
                        </Link>
                    </div>
                ) : (
                    <div id="tour-grid" className="space-y-10">
                        {SECTION_ORDER.map((title) => {
                            const group = items.filter((item) => sectionFor(item.product?.category) === title);
                            if (group.length === 0) return null;
                            return (
                                <section key={title} className="rise">
                                    <div className="flex items-center gap-3 mb-4">
                                        <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
                                        <span className="pill bg-paper-2 text-ink-soft">{group.length}</span>
                                        <span className="flex-1 h-px bg-line" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {group.map((item) => (
                                            <ProductCard key={item._id} item={item} onConsume={handleConsume} onDelete={handleDelete} />
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </main>

            <Tour run={runTour} onFinish={finishTour} />

            {selectedItem && (
                <ProductSurvey
                    isOpen={surveyOpen}
                    onClose={() => { setSurveyOpen(false); setSelectedItem(null); }}
                    productName={selectedItem.product.name}
                    expectedDays={selectedItem.product.averageDuration || 14}
                    familySize={familySize}
                    onSubmit={handleSurveySubmit}
                />
            )}
        </div>
    );
}

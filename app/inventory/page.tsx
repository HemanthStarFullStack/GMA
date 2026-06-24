"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Loader2, BarChart3, ShoppingCart, Search } from "lucide-react";
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

type SortBy = "recent" | "name" | "qty";
const SORTS: { value: SortBy; label: string }[] = [
    { value: "recent", label: "Recently added" },
    { value: "name", label: "Name A–Z" },
    { value: "qty", label: "Quantity low→high" },
];

export default function InventoryPage() {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [familySize, setFamilySize] = useState(1);
    const [surveyOpen, setSurveyOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
    const [query, setQuery] = useState("");
    const [sortBy, setSortBy] = useState<SortBy>("recent");
    const [section, setSection] = useState<string>("all");

    useEffect(() => {
        (async () => {
            // Demo seeding is owned solely by the tour (GmaTour) so there's no race
            // between two concurrent /api/demo POSTs leaving the page fetching an
            // empty inventory before the seed finishes writing.
            await fetchInventory();
            try {
                const data = await (await fetch("/api/user")).json();
                if (data.success) setFamilySize(data.data.familySize ?? 1);
            } catch {
                /* keep defaults */
            }
            setLoading(false);
        })();
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

    // Adjust pack count by ±1. A decrement that would hit 0 returns 409 — that
    // means "finish the last pack", so we fall back to the consume/survey flow.
    const handleAdjust = async (id: string, delta: number) => {
        try {
            const res = await fetch("/api/inventory", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, delta }),
            });
            if (res.status === 409) {
                handleConsume(id);
                return;
            }
            const data = await res.json();
            if (data.success) fetchInventory();
        } catch (error) {
            console.error("Failed to adjust quantity:", error);
        }
    };

    // Search + sort applied across all items; section filter narrows which shelves show.
    const processed = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = q
            ? items.filter((i) =>
                  `${i.product?.name ?? ""} ${i.product?.brand ?? ""}`.toLowerCase().includes(q),
              )
            : items;
        const sorted = [...filtered];
        if (sortBy === "name") {
            sorted.sort((a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? ""));
        } else if (sortBy === "qty") {
            sorted.sort((a, b) => a.quantity - b.quantity);
        }
        // "recent" keeps the API order (purchaseDate desc).
        return sorted;
    }, [items, query, sortBy]);

    const sectionsToRender = section === "all" ? SECTION_ORDER : [section];
    const hasMatches = processed.length > 0;

    return (
        <div className="min-h-screen">
            <header className="bg-paper/85 backdrop-blur border-b border-line sticky top-0 z-10">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-ink-soft hover:text-ink">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink">Inventory</h1>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <Link href="/shopping" data-tour="shopping" title="Shopping list" className="flex w-10 h-10 rounded-full border border-line-strong items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors">
                            <ShoppingCart className="w-5 h-5" />
                        </Link>
                        <Link id="tour-analytics" href="/analytics" title="Analytics" className="hidden sm:flex w-10 h-10 rounded-full border border-line-strong items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors">
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
                    <>
                        {/* Search · sort · section filter */}
                        <div className="mb-8 space-y-3">
                            <div className="flex flex-col sm:flex-row gap-3">
                                <div data-tour="search" className="relative flex-1">
                                    <Search className="w-4 h-4 text-ink-faint absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search by name or brand…"
                                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-line-strong bg-card text-ink focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta outline-none"
                                    />
                                </div>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value as SortBy)}
                                    className="px-3 py-2.5 rounded-xl border border-line-strong bg-card text-ink focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta outline-none"
                                >
                                    {SORTS.map((s) => (
                                        <option key={s.value} value={s.value}>{s.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {["all", ...SECTION_ORDER].map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => setSection(s)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-semibold transition border ${section === s ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-line-strong text-ink-soft hover:border-ink-faint"}`}
                                    >
                                        {s === "all" ? "All" : s}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {!hasMatches ? (
                            <div className="text-center py-16 rise">
                                <div className="w-16 h-16 bg-paper-2 border border-line rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search className="w-8 h-8 text-ink-faint" />
                                </div>
                                <h3 className="font-display text-2xl font-semibold text-ink mb-2">No matches</h3>
                                <p className="text-ink-soft">Try a different search.</p>
                            </div>
                        ) : (
                            <div id="tour-grid" className="space-y-10">
                                {sectionsToRender.map((title) => {
                                    const group = processed.filter((item) => sectionFor(item.product?.category) === title);
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
                                                    <ProductCard key={item._id} item={item} onConsume={handleConsume} onDelete={handleDelete} onAdjust={handleAdjust} />
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </main>

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

"use client";

import { useEffect, useState } from "react";
import { Package, Clock, TrendingDown, Check, X, AlertTriangle, Loader2, ChevronLeft } from "lucide-react";
import BackButton from "@/components/BackButton";
import UserMenu from "@/components/UserMenu";
import { formatStock } from "@/lib/formatStock";

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
    estimatedDurationDays: number;
    consumptionHistory: {
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
    const [selected, setSelected] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/analytics');
                const json = await res.json();
                if (json.success) {
                    setProducts(json.data.products || []);
                    if (json.data.products?.length) setSelected(json.data.products[0]);
                }
            } catch (error) {
                console.error('Failed to load analytics:', error);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    return (
        <div className="min-h-screen">
            <header className="bg-paper/85 backdrop-blur border-b border-line sticky top-0 z-10">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <BackButton />
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink">Analytics</h1>
                    <UserMenu />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8">
                {loading ? (
                    <div className="flex justify-center py-24"><Loader2 className="w-9 h-9 animate-spin text-terracotta" /></div>
                ) : products.length === 0 ? (
                    <div className="pantry-card p-12 text-center max-w-lg mx-auto rise">
                        <Package className="w-14 h-14 text-ink-faint mx-auto mb-4" strokeWidth={1.5} />
                        <h3 className="font-display text-2xl font-semibold text-ink mb-2">Nothing to analyse yet</h3>
                        <p className="text-ink-soft">Scan products and mark them consumed to build forecasts.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* List — hidden on mobile when a product is selected */}
                        <div className={`md:col-span-1 ${selected ? "hidden md:block" : ""}`}>
                            <div data-tour="analytics-list" className="pantry-card p-4 md:sticky md:top-24">
                                <p className="kicker mb-3">All products · {products.length}</p>
                                <div className="space-y-1.5 max-h-[50vh] md:max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
                                    {products.map((p) => (
                                        <button
                                            key={p.productId}
                                            onClick={() => setSelected(p)}
                                            className={`w-full text-left p-3 rounded-xl transition-all flex items-center gap-3 ${selected?.productId === p.productId ? "bg-terracotta text-paper" : "hover:bg-paper-2"}`}
                                        >
                                            <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                                                {p.imageUrl ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <Package className={`w-5 h-5 ${selected?.productId === p.productId ? "text-paper" : "text-ink-faint"}`} strokeWidth={1.6} />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold truncate text-sm">{p.name}</p>
                                                <p className={`text-xs truncate ${selected?.productId === p.productId ? "text-paper/70" : "text-ink-faint"}`}>{p.brand || "—"}</p>
                                            </div>
                                            {p.predictions?.needsRestock ? (
                                                <AlertTriangle className="w-4 h-4 text-amber flex-shrink-0" />
                                            ) : p.status === "in_stock" ? (
                                                <Check className={`w-4 h-4 flex-shrink-0 ${selected?.productId === p.productId ? "text-paper" : "text-olive"}`} />
                                            ) : (
                                                <X className={`w-4 h-4 flex-shrink-0 ${selected?.productId === p.productId ? "text-paper/70" : "text-ink-faint"}`} />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Detail — full width on mobile, 2 cols on md+ */}
                        {selected && (
                            <div data-tour="analytics-detail" className="md:col-span-2 rise">
                                {/* Mobile back-to-list */}
                                <button
                                    className="md:hidden mb-4 flex items-center gap-2 text-sm font-medium text-ink-soft hover:text-ink"
                                    onClick={() => setSelected(null)}
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                    All products
                                </button>
                                <div className="pantry-card p-6">
                                    <div className="flex items-start gap-5 mb-6">
                                        <div className="w-24 h-24 rounded-2xl bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {selected.imageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={selected.imageUrl} alt={selected.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <Package className="w-10 h-10 text-ink-faint" strokeWidth={1.5} />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {selected.brand && <p className="kicker truncate">{selected.brand}</p>}
                                            <h2 className="font-display text-3xl font-semibold text-ink leading-tight break-words">{selected.name}</h2>
                                            <div className="flex gap-2 mt-2">
                                                <span className="pill bg-paper-2 text-ink-soft">{selected.category}</span>
                                                <span className={`pill ${selected.status === "in_stock" ? "bg-olive/10 text-olive" : "bg-berry/10 text-berry"}`}>
                                                    {selected.status === "in_stock" ? "In stock" : "Out of stock"}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {selected.status === "in_stock" && (
                                        <div className="mb-6 bg-paper-2/60 rounded-xl p-4 border border-line">
                                            <p className="kicker mb-1">Current stock</p>
                                            <p className="font-display text-3xl font-semibold text-ink">{formatStock(selected.currentStock, selected.unit)}</p>
                                        </div>
                                    )}

                                    {selected.consumptionHistory.timesConsumed > 0 && (
                                        <div className="mb-6">
                                            <p className="kicker mb-3">Consumption history</p>
                                            <div className="grid grid-cols-2 gap-3">
                                                <Stat label="Units used" value={`${selected.consumptionHistory.timesConsumed}`} />
                                                <Stat label="Avg days / unit" value={`${selected.consumptionHistory.averageDurationDays} days`} />
                                                <Stat label="Last used" value={selected.consumptionHistory.lastConsumed ? new Date(selected.consumptionHistory.lastConsumed).toLocaleDateString() : "—"} />
                                            </div>
                                        </div>
                                    )}

                                    {selected.predictions ? (
                                        <div>
                                            <p className="kicker mb-3">Forecast</p>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="rounded-xl p-4 border border-olive/25 bg-olive/5">
                                                    <div className="flex items-center gap-2 mb-1 text-olive">
                                                        <TrendingDown className="w-4 h-4" />
                                                        <span className="text-xs font-semibold">Consumption rate</span>
                                                    </div>
                                                    <p className="font-display text-2xl font-semibold text-ink">{selected.predictions.consumptionRate} <span className="text-base text-ink-soft">{selected.unit}/day</span></p>
                                                </div>
                                                <div className={`rounded-xl p-4 border ${selected.predictions.needsRestock ? "border-terracotta/30 bg-terracotta/5" : "border-olive/25 bg-olive/5"}`}>
                                                    <div className={`flex items-center gap-2 mb-1 ${selected.predictions.needsRestock ? "text-terracotta" : "text-olive"}`}>
                                                        <Clock className="w-4 h-4" />
                                                        <span className="text-xs font-semibold">Days until empty</span>
                                                    </div>
                                                    <p className={`font-display text-2xl font-semibold ${selected.predictions.needsRestock ? "text-terracotta" : "text-ink"}`}>{selected.predictions.daysUntilEmpty} days</p>
                                                </div>
                                                <div className="col-span-2 rounded-xl p-4 border border-amber/30 bg-amber/5">
                                                    <p className="text-xs font-semibold text-amber mb-1">Estimated restock date</p>
                                                    <p className="font-display text-xl font-semibold text-ink">
                                                        {new Date(selected.predictions.restockDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </p>
                                                </div>
                                            </div>

                                            {selected.predictions.needsRestock && (
                                                <div className="mt-4 bg-terracotta/10 border border-terracotta/30 rounded-xl p-4 flex items-center gap-3">
                                                    <AlertTriangle className="w-5 h-5 text-terracotta flex-shrink-0" />
                                                    <p className="text-sm text-terracotta-deep"><strong>Restock soon</strong> — runs out in under 7 days.</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : selected.estimatedDurationDays > 0 ? (
                                        <div>
                                            <p className="kicker mb-3">Estimated</p>
                                            <div className="rounded-xl p-4 border border-amber/30 bg-amber/5">
                                                <div className="flex items-center gap-2 mb-1 text-amber">
                                                    <Clock className="w-4 h-4" />
                                                    <span className="text-xs font-semibold">Lasts about</span>
                                                </div>
                                                <p className="font-display text-2xl font-semibold text-ink">
                                                    {selected.estimatedDurationDays} <span className="text-base text-ink-soft">days / {selected.unit}</span>
                                                </p>
                                                <p className="text-xs text-ink-soft mt-2">
                                                    {selected.consumptionHistory.timesConsumed > 0
                                                        ? "Learned from your usage."
                                                        : "AI estimate — refines as you mark it consumed."}
                                                    {selected.status === "out_of_stock" && " Add it back to stock to get a run-out date."}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-paper-2/60 border border-line rounded-xl p-6 text-center">
                                            <p className="text-ink-soft text-sm">No forecast yet — mark this product consumed a few times to learn its rhythm.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-paper-2/60 rounded-xl p-4 border border-line">
            <p className="text-xs text-ink-faint mb-1">{label}</p>
            <p className="font-display text-xl font-semibold text-ink">{value}</p>
        </div>
    );
}

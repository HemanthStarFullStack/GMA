"use client";

import { useEffect, useState, useCallback } from "react";
import { ShoppingCart, Plus, Minus, Check, X, Trash2, Loader2, Package, ChevronDown, ChevronRight } from "lucide-react";
import BackButton from "@/components/BackButton";
import UserMenu from "@/components/UserMenu";

interface ListItem {
    _id: string;
    productId: string | null;
    name: string;
    brand: string;
    imageUrl: string | null;
    unit: string | null;
    reason: "low_stock" | "out_of_stock" | "manual";
    source: "auto" | "manual";
    status: "pending" | "done";
    restockQty: number;
    boughtAt: string | null;
}

const REASON: Record<string, { label: string; cls: string }> = {
    out_of_stock: { label: "Out of stock", cls: "bg-berry/10 text-berry" },
    low_stock: { label: "Running low", cls: "bg-amber/10 text-amber" },
    manual: { label: "Added by you", cls: "bg-paper-2 text-ink-soft" },
};

export default function ShoppingPage() {
    const [items, setItems] = useState<ListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const [name, setName] = useState("");
    const [adding, setAdding] = useState(false);
    const [showDone, setShowDone] = useState(false);
    // Per-item rebuy quantity the user can dial before ticking "Got it". Falls
    // back to the suggested restockQty until they touch it; their edits survive
    // list refreshes.
    const [qty, setQty] = useState<Record<string, number>>({});

    const getQty = (item: ListItem) => qty[item._id] ?? Math.max(1, item.restockQty || 1);
    const bumpQty = (item: ListItem, delta: number) =>
        setQty((q) => ({ ...q, [item._id]: Math.max(1, Math.min(99, getQty(item) + delta)) }));

    const fetchList = useCallback(async () => {
        try {
            const res = await fetch("/api/shopping-list");
            const data = await res.json();
            if (data.success) setItems(data.data.items);
        } catch (error) {
            console.error("Failed to load shopping list:", error);
        }
    }, []);

    useEffect(() => {
        (async () => {
            await fetchList();
            setLoading(false);
        })();
    }, [fetchList]);

    const withBusy = async (id: string, fn: () => Promise<void>) => {
        setBusy((s) => new Set(s).add(id));
        try {
            await fn();
            await fetchList();
        } finally {
            setBusy((s) => {
                const n = new Set(s);
                n.delete(id);
                return n;
            });
        }
    };

    const act = (id: string, action: "check" | "uncheck" | "dismiss", qtyToAdd?: number) =>
        withBusy(id, async () => {
            await fetch("/api/shopping-list", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action, ...(qtyToAdd ? { qty: qtyToAdd } : {}) }),
            });
        });

    const remove = (id: string) =>
        withBusy(id, async () => {
            await fetch(`/api/shopping-list?id=${id}`, { method: "DELETE" });
        });

    const addManual = async () => {
        const trimmed = name.trim();
        if (!trimmed || adding) return;
        setAdding(true);
        try {
            const res = await fetch("/api/shopping-list", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: trimmed }),
            });
            if (res.ok) {
                setName("");
                await fetchList();
            }
        } finally {
            setAdding(false);
        }
    };

    const pending = items.filter((i) => i.status === "pending");
    const done = items.filter((i) => i.status === "done");

    return (
        <div className="min-h-screen">
            <header className="bg-paper/85 backdrop-blur border-b border-line sticky top-0 z-10">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <BackButton />
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5 text-terracotta" />
                        Shopping
                    </h1>
                    <UserMenu />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8 max-w-2xl">
                {/* Add item */}
                <div data-tour="shop-add" className="flex gap-2 mb-6">
                    <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addManual()}
                        placeholder="Add an item…"
                        maxLength={100}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-line-strong bg-card text-ink focus:ring-2 focus:ring-terracotta/40 focus:border-terracotta outline-none"
                    />
                    <button
                        onClick={addManual}
                        disabled={!name.trim() || adding}
                        className="btn-primary px-4 py-2.5 flex items-center gap-2 disabled:opacity-50"
                    >
                        {adding ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                        Add
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-terracotta" /></div>
                ) : pending.length === 0 && done.length === 0 ? (
                    <div className="text-center py-16 rise">
                        <div className="w-16 h-16 bg-paper-2 border border-line rounded-full flex items-center justify-center mx-auto mb-4">
                            <ShoppingCart className="w-8 h-8 text-ink-faint" />
                        </div>
                        <h3 className="font-display text-2xl font-semibold text-ink mb-2">Nothing to buy</h3>
                        <p className="text-ink-soft">Items running low show up here automatically — or add your own above.</p>
                    </div>
                ) : (
                    <>
                        <div data-tour="shop-list" className="space-y-2.5">
                            {pending.map((item) => {
                                const r = REASON[item.reason] ?? REASON.manual;
                                const isBusy = busy.has(item._id);
                                return (
                                    <div key={item._id} className="pantry-card flex items-center gap-3 p-3 rise">
                                        <button
                                            onClick={() => act(item._id, "check", item.productId ? getQty(item) : undefined)}
                                            disabled={isBusy}
                                            title={item.productId ? `Got it — add ${getQty(item)} to inventory` : "Got it"}
                                            className="w-7 h-7 rounded-full border-2 border-line-strong flex items-center justify-center text-transparent hover:border-olive hover:text-olive transition-colors flex-shrink-0 disabled:opacity-50"
                                        >
                                            {isBusy ? <Loader2 className="w-4 h-4 animate-spin text-ink-faint" /> : <Check className="w-4 h-4" />}
                                        </button>

                                        <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {item.imageUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <Package className="w-5 h-5 text-ink-faint" strokeWidth={1.6} />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            {item.brand && <p className="kicker truncate">{item.brand}</p>}
                                            <h3 className="font-semibold text-ink truncate">{item.name}</h3>
                                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                                <span className={`pill ${r.cls}`}>{r.label}</span>
                                                {/* Pack size only — the count lives in the stepper. */}
                                                {item.unit && !/^units?$/i.test(item.unit) && (
                                                    <span className="pill bg-paper-2 text-ink-soft">{item.unit}</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Quantity to add to inventory on "Got it" — only for catalogue
                                            items (manual free-text items can't be added). */}
                                        {item.productId && (
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <button
                                                    onClick={() => bumpQty(item, -1)}
                                                    disabled={isBusy || getQty(item) <= 1}
                                                    title="Fewer"
                                                    className="w-7 h-7 rounded-full border border-line-strong flex items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors disabled:opacity-40"
                                                >
                                                    <Minus className="w-3.5 h-3.5" />
                                                </button>
                                                <span className="w-5 text-center text-sm font-semibold text-ink tabular-nums">{getQty(item)}</span>
                                                <button
                                                    onClick={() => bumpQty(item, 1)}
                                                    disabled={isBusy}
                                                    title="More"
                                                    className="w-7 h-7 rounded-full border border-line-strong flex items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors disabled:opacity-50"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => (item.source === "manual" ? remove(item._id) : act(item._id, "dismiss"))}
                                            disabled={isBusy}
                                            title={item.source === "manual" ? "Remove" : "Dismiss"}
                                            className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:text-berry hover:bg-berry/5 transition-colors flex-shrink-0 disabled:opacity-50"
                                        >
                                            {item.source === "manual" ? <Trash2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {done.length > 0 && (
                            <div className="mt-8">
                                <button
                                    onClick={() => setShowDone((v) => !v)}
                                    className="flex items-center gap-2 text-sm font-semibold text-ink-soft hover:text-ink mb-3"
                                >
                                    {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    Got it · {done.length}
                                </button>
                                {showDone && (
                                    <div className="space-y-2.5">
                                        {done.map((item) => {
                                            const isBusy = busy.has(item._id);
                                            return (
                                                <div key={item._id} className="pantry-card flex items-center gap-3 p-3 opacity-70">
                                                    <button
                                                        onClick={() => act(item._id, "uncheck")}
                                                        disabled={isBusy}
                                                        title="Undo"
                                                        className="w-7 h-7 rounded-full bg-olive/15 border-2 border-olive flex items-center justify-center text-olive flex-shrink-0 disabled:opacity-50"
                                                    >
                                                        {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                                    </button>
                                                    <div className="flex-1 min-w-0">
                                                        {item.brand && <p className="kicker truncate">{item.brand}</p>}
                                                        <h3 className="font-semibold text-ink truncate line-through">{item.name}</h3>
                                                    </div>
                                                    {item.source === "manual" && (
                                                        <button
                                                            onClick={() => remove(item._id)}
                                                            disabled={isBusy}
                                                            title="Remove"
                                                            className="w-9 h-9 rounded-full flex items-center justify-center text-ink-faint hover:text-berry hover:bg-berry/5 transition-colors flex-shrink-0 disabled:opacity-50"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Plus, Minus, Check, X, Trash2, Loader2, Package, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
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
    status: "pending" | "done" | "dismissed";
    restockQty: number;
    boughtAt: string | null;
}

const REASON: Record<string, { label: string; cls: string }> = {
    out_of_stock: { label: "Out of stock", cls: "bg-berry/10 text-berry" },
    low_stock: { label: "Running low", cls: "bg-amber/10 text-amber" },
    manual: { label: "Added by you", cls: "bg-paper-2 text-ink-soft" },
};

export default function ShoppingPage() {
    const router = useRouter();
    const [items, setItems] = useState<ListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<Set<string>>(new Set());
    const [showDone, setShowDone] = useState(false);
    const [showDismissed, setShowDismissed] = useState(false);
    // Per-item rebuy quantity the user dials before ticking "Bought"; defaults to
    // the remembered purchase quantity from the server. Their edits survive refreshes.
    const [qty, setQty] = useState<Record<string, number>>({});
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 2500);
        return () => clearTimeout(t);
    }, [toast]);

    const getQty = (item: ListItem) => qty[item._id] ?? item.restockQty ?? 1;
    const bumpQty = (item: ListItem, delta: number) =>
        setQty((q) => ({ ...q, [item._id]: Math.max(1, Math.min(99, getQty(item) + delta)) }));

    const fetchList = useCallback(async () => {
        try {
            const res = await fetch("/api/shopping-list", { cache: 'no-store' });
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
            router.refresh(); // invalidate Router Cache so the home badge is fresh on back-nav
        } finally {
            setBusy((s) => {
                const n = new Set(s);
                n.delete(id);
                return n;
            });
        }
    };

    const act = (id: string, action: "uncheck" | "dismiss") =>
        withBusy(id, async () => {
            await fetch("/api/shopping-list", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action }),
            });
        });

    const resetQty = (item: ListItem) => {
        setQty((q) => ({ ...q, [item._id]: 1 }));
        return withBusy(item._id, async () => {
            await fetch("/api/shopping-list", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: item._id, action: "resetQty" }),
            });
        });
    };

    // Separate handler for "check" so we can show a toast when inventory is added.
    const handleCheck = (item: ListItem) => {
        const willAdd = !!item.productId && !item.boughtAt;
        const qtyToAdd = item.productId ? getQty(item) : undefined;
        setBusy((s) => new Set(s).add(item._id));
        fetch("/api/shopping-list", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item._id, action: "check", ...(qtyToAdd ? { qty: qtyToAdd } : {}) }),
        })
            .then((r) => r.json())
            .then((data) => {
                if (willAdd && data.success) setToast(`Added ${qtyToAdd ?? 1}× ${item.name} to your pantry`);
                else if (!data.success) setToast("Couldn't update — please try again");
            })
            .catch(() => setToast("Couldn't update — please try again"))
            .finally(() => {
                setBusy((s) => { const n = new Set(s); n.delete(item._id); return n; });
                fetchList();
                router.refresh(); // invalidate Router Cache so the home badge is fresh on back-nav
            });
    };

    const remove = (id: string) =>
        withBusy(id, async () => {
            await fetch(`/api/shopping-list?id=${id}`, { method: "DELETE" });
        });

    // "Add item" opens the same manual-entry form as product scan — collects
    // brand/price/etc. and creates the shopping-list entry from there.
    const addManual = () => router.push("/scan?to=shopping");

    const pending = items.filter((i) => i.status === "pending");
    const done = items.filter((i) => i.status === "done");
    const dismissed = items.filter((i) => i.status === "dismissed");

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
                <button
                    data-tour="shop-add"
                    onClick={addManual}
                    className="btn-primary w-full py-4 mb-6 flex items-center justify-center gap-2 text-lg font-semibold"
                >
                    <Plus className="w-6 h-6" />
                    Add item
                </button>

                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-terracotta" /></div>
                ) : pending.length === 0 && done.length === 0 && dismissed.length === 0 ? (
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
                                            onClick={() => handleCheck(item)}
                                            disabled={isBusy}
                                            title={item.productId ? `Bought — add ${getQty(item)} to inventory` : "Bought"}
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

                                        {/* Quantity to add to inventory on "Bought" — only for catalogue
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
                                                <button
                                                    onClick={() => resetQty(item)}
                                                    disabled={isBusy || getQty(item) === 1}
                                                    title="Reset remembered quantity"
                                                    className="w-7 h-7 rounded-full border border-line-strong flex items-center justify-center text-ink-soft hover:bg-paper-2 transition-colors disabled:opacity-40"
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
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
                                    Bought · {done.length}
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

                        {dismissed.length > 0 && (
                            <div className="mt-6">
                                <button
                                    onClick={() => setShowDismissed((v) => !v)}
                                    className="flex items-center gap-2 text-sm font-semibold text-ink-faint hover:text-ink-soft mb-3"
                                >
                                    {showDismissed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    Dismissed · {dismissed.length}
                                </button>
                                {showDismissed && (
                                    <div className="space-y-2">
                                        {dismissed.map((item) => {
                                            const isBusy = busy.has(item._id);
                                            return (
                                                <div key={item._id} className="pantry-card flex items-center gap-3 p-3 opacity-50">
                                                    <div className="flex-1 min-w-0">
                                                        {item.brand && <p className="kicker truncate">{item.brand}</p>}
                                                        <h3 className="font-semibold text-ink-soft truncate">{item.name}</h3>
                                                    </div>
                                                    <button
                                                        onClick={() => act(item._id, "uncheck")}
                                                        disabled={isBusy}
                                                        title="Restore to list"
                                                        className="text-xs font-semibold text-ink-soft border border-line-strong px-3 py-1.5 rounded-full hover:text-ink hover:bg-paper-2 transition-colors disabled:opacity-50 flex-shrink-0 flex items-center gap-1.5"
                                                    >
                                                        {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Restore"}
                                                    </button>
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

            {toast && (
                <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-ink text-paper rounded-xl shadow-lg text-sm font-medium pointer-events-none">
                    {toast}
                </div>
            )}
        </div>
    );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BarcodeScanner from "@/components/BarcodeScanner";
import { ArrowLeft, Package, CheckCircle2, Loader2, Minus, Plus } from "lucide-react";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";

const CATEGORIES = [
    "Dairy & Eggs", "Beverages", "Fruits & Vegetables", "Meat & Seafood",
    "Bakery", "Pantry", "Frozen Foods", "Snacks", "Condiments & Sauces",
    "Cleaning & Household", "Personal Care", "Other",
];

type Found = {
    barcode: string;
    name: string;
    brand: string;
    flavor?: string;
    category: string;
    imageUrl: string | null;
    unit: string;
    source: string;
};

type Mode = "scan" | "confirm" | "manual" | "saving" | "done";

export default function ScanPage() {
    const router = useRouter();
    const [mode, setMode] = useState<Mode>("scan");
    const [found, setFound] = useState<Found | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [toast, setToast] = useState<string | null>(null);
    const [lookingUp, setLookingUp] = useState(false);

    const [form, setForm] = useState({
        barcode: "",
        name: "",
        brand: "",
        category: "Other",
        unit: "units",
        quantity: 1,
        averageDuration: 14,
    });

    const handleScan = async (barcode: string) => {
        setLookingUp(true);
        try {
            const res = await fetch(`/api/barcode?barcode=${encodeURIComponent(barcode)}`);
            const data = await res.json();
            if (data.success) {
                setFound({ ...data.data, source: data.source });
                setQuantity(1);
                setMode("confirm");
            } else {
                if (data.code === "RATE_LIMITED") {
                    setToast("Daily lookup limit reached. The product may exist — fill it in manually.");
                }
                setForm((f) => ({ ...f, barcode, name: "", brand: "", category: "Other", unit: "units", quantity: 1, averageDuration: 14 }));
                setMode("manual");
            }
        } catch {
            setForm((f) => ({ ...f, barcode }));
            setToast("Barcode lookup failed. Check your connection and add the product manually.");
            setMode("manual");
        } finally {
            setLookingUp(false);
        }
    };

    const openManual = () => {
        setForm((f) => ({ ...f, barcode: `MANUAL-${Date.now()}`, name: "", brand: "", category: "Other", unit: "units", quantity: 1, averageDuration: 14 }));
        setMode("manual");
    };

    const addFound = async () => {
        if (!found) return;
        setMode("saving");
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId: found.barcode,
                    quantity,
                    unit: found.unit || "units",
                    productDetails: {
                        name: found.name, brand: found.brand, flavor: found.flavor,
                        category: found.category, imageUrl: found.imageUrl, unit: found.unit,
                        addedBy: "barcode", source: found.source,
                    },
                }),
            });
            if (!res.ok) throw new Error();
            finish(`${found.name} added`);
        } catch {
            setToast("Could not add item. Try again.");
            setMode("confirm");
        }
    };

    const addManual = async () => {
        if (!form.name.trim()) {
            setToast("Please enter a product name.");
            return;
        }
        setMode("saving");
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId: form.barcode || `MANUAL-${Date.now()}`,
                    quantity: form.quantity,
                    unit: form.unit || "units",
                    productDetails: {
                        name: form.name.trim(), brand: form.brand.trim(), category: form.category,
                        unit: form.unit, averageDuration: Number(form.averageDuration) || 14,
                        addedBy: "manual", source: "manual",
                    },
                }),
            });
            if (!res.ok) throw new Error();
            finish(`${form.name.trim()} added`);
        } catch {
            setToast("Could not add item. Try again.");
            setMode("manual");
        }
    };

    const finish = (msg: string) => {
        setMode("done");
        setToast(msg);
        setTimeout(() => router.push("/inventory"), 1100);
    };

    return (
        <div className="min-h-screen">
            <header className="border-b border-line">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 text-ink-soft hover:text-ink">
                        <ArrowLeft className="w-5 h-5" />
                        <span className="font-medium">Back</span>
                    </Link>
                    <h1 className="font-display text-2xl font-semibold text-ink">Add a product</h1>
                    <UserMenu />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8 max-w-xl">
                {mode === "scan" && (
                    <div className="rise">
                        <p className="kicker mb-3 text-center">Point · scan · confirm</p>
                        <div className="aspect-[3/4] sm:aspect-video w-full ring-1 ring-line rounded-2xl overflow-hidden shadow-xl relative">
                            <BarcodeScanner onScan={handleScan} onManual={openManual} onError={(e) => setToast(e)} />
                            {lookingUp && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                    <Loader2 className="w-10 h-10 animate-spin text-white" />
                                    <p className="mt-3 text-white text-sm font-medium">Looking up barcode…</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {mode === "confirm" && found && (
                    <div className="pantry-card overflow-hidden rise">
                        <div className="p-5 flex gap-4">
                            <div className="w-24 h-24 rounded-xl bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                                {found.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={found.imageUrl} alt={found.name} className="w-full h-full object-cover" />
                                ) : (
                                    <Package className="w-10 h-10 text-ink-faint" strokeWidth={1.6} />
                                )}
                            </div>
                            <div className="min-w-0">
                                {found.brand && <p className="kicker">{found.brand}</p>}
                                <h2 className="font-display text-xl font-semibold text-ink leading-tight">{found.name}</h2>
                                <span className="inline-block mt-2 pill bg-olive/10 text-olive">
                                    {found.source === "cache" ? "from your library" : `via ${found.source}`}
                                </span>
                            </div>
                        </div>

                        <div className="px-5 pb-3">
                            <label className="block">
                                <span className="block text-xs font-semibold text-ink-soft mb-1">
                                    Category <span className="text-ink-faint font-normal">· suggested by AI, adjust if needed</span>
                                </span>
                                <select
                                    value={found.category}
                                    onChange={(e) => setFound({ ...found, category: e.target.value })}
                                    className={inputCls}
                                >
                                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                </select>
                            </label>
                        </div>

                        <div className="px-5 pb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-ink-soft">Quantity</span>
                            <div className="flex items-center gap-3">
                                <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2">
                                    <Minus className="w-4 h-4" />
                                </button>
                                <span className="w-6 text-center font-semibold text-ink">{quantity}</span>
                                <button onClick={() => setQuantity((q) => q + 1)} className="w-9 h-9 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2">
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="p-5 flex gap-3">
                            <button onClick={() => setMode("scan")} className="btn-ghost flex-1 py-3">Scan again</button>
                            <button onClick={addFound} className="btn-primary flex-1 py-3">Add to inventory</button>
                        </div>
                    </div>
                )}

                {mode === "manual" && (
                    <div className="pantry-card p-6 rise">
                        <h2 className="font-display text-2xl font-semibold text-ink mb-1">Add manually</h2>
                        <p className="text-sm text-ink-soft mb-5">
                            {form.barcode.startsWith("MANUAL-") ? "No barcode — just type the details." : <>Barcode <span className="font-mono text-ink">{form.barcode}</span> isn’t in any database yet.</>}
                            {" "}It’ll be saved for instant lookup next time.
                        </p>

                        <div className="space-y-3">
                            <Field label="Product name *">
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Toned Milk 1L" className={inputCls} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Brand">
                                    <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Amul" className={inputCls} />
                                </Field>
                                <Field label="Category">
                                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </Field>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <Field label="Unit">
                                    <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="units" className={inputCls} />
                                </Field>
                                <Field label="Quantity">
                                    <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Math.max(1, +e.target.value || 1) })} className={inputCls} />
                                </Field>
                                <Field label="Lasts (days)">
                                    <input type="number" min={1} value={form.averageDuration} onChange={(e) => setForm({ ...form, averageDuration: Math.max(1, +e.target.value || 1) })} className={inputCls} />
                                </Field>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setMode("scan")} className="btn-ghost flex-1 py-3">Cancel</button>
                            <button onClick={addManual} className="btn-primary flex-1 py-3">Add to inventory</button>
                        </div>
                    </div>
                )}

                {(mode === "saving" || mode === "done") && (
                    <div className="flex flex-col items-center justify-center py-24 text-center rise">
                        {mode === "saving" ? (
                            <Loader2 className="w-12 h-12 animate-spin text-terracotta" />
                        ) : (
                            <CheckCircle2 className="w-14 h-14 text-olive" />
                        )}
                        <p className="mt-4 font-display text-xl text-ink">{mode === "saving" ? "Adding…" : toast}</p>
                    </div>
                )}

                {toast && mode !== "done" && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-ink text-paper text-sm px-4 py-2 rounded-full shadow-lg">
                        {toast}
                        <button onClick={() => setToast(null)} className="ml-3 text-paper/60 hover:text-paper">✕</button>
                    </div>
                )}
            </main>
        </div>
    );
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-line-strong bg-card focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none text-sm text-ink placeholder:text-ink-faint";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-ink-soft mb-1">{label}</span>
            {children}
        </label>
    );
}

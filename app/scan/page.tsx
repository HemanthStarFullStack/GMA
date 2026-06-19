"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import { ArrowLeft, Package, CheckCircle2, Loader2, Minus, Plus, Sparkles, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";

const CATEGORIES = [
    "Dairy & Eggs", "Beverages", "Fruits & Vegetables", "Meat & Seafood",
    "Bakery", "Pantry", "Frozen Foods", "Snacks", "Condiments & Sauces",
    "Cleaning & Household", "Personal Care", "Other",
];

type Mode = "scan" | "confirm" | "manual" | "saving" | "done";

type Form = {
    barcode: string;
    name: string;
    brand: string;
    flavor: string;
    price: string;
    category: string;
    unit: string;
    quantity: number;
    averageDuration: number;
    imageUrl: string | null;
    source: string;
    addedBy: "barcode" | "manual";
};

const emptyForm = (barcode = ""): Form => ({
    barcode,
    name: "",
    brand: "",
    flavor: "",
    price: "",
    category: "Other",
    unit: "units",
    quantity: 1,
    averageDuration: 14,
    imageUrl: null,
    source: "manual",
    addedBy: "manual",
});

export default function ScanPage() {
    const router = useRouter();
    const [mode, setMode] = useState<Mode>("scan");
    const [toast, setToast] = useState<string | null>(null);
    const [lookingUp, setLookingUp] = useState(false);
    const [reestimating, setReestimating] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [form, setForm] = useState<Form>(emptyForm());
    const fileRef = useRef<HTMLInputElement>(null);

    const handlePhoto = async (image: Blob) => {
        setLookingUp(true);
        // The shot doubles as the product photo — upload it alongside OCR so it
        // costs no extra wait. Best-effort: a failed upload just leaves no image.
        const uploadPromise = (async () => {
            try {
                const fd = new FormData();
                fd.append("file", image, "label.jpg");
                const r = await fetch("/api/upload", { method: "POST", body: fd });
                const j = await r.json();
                return j.success ? (j.url as string) : null;
            } catch {
                return null;
            }
        })();
        try {
            const visRes = await fetch("/api/product-vision", { method: "POST", body: image });
            const vis = await visRes.json();
            const imageUrl = await uploadPromise;
            const d = vis.data || {};

            // Back/nutrition panel: name & brand aren't here — guide to the
            // front, but keep the net quantity if we got it.
            if (d.backPanel) {
                setToast(
                    `Looks like the back of the pack — snap the front for the name & brand.${d.quantity ? ` Size ${d.quantity} filled in.` : ""}`,
                );
                setForm({ ...emptyForm(), unit: d.quantity || "units", source: "ocr", imageUrl });
                setMode("manual");
                return;
            }
            if (!vis.success || !d.name) {
                setToast("Couldn't read the label — type the details and it'll be saved.");
                setForm({ ...emptyForm(), unit: d.quantity || "units", source: "ocr", imageUrl });
                setMode("manual");
                return;
            }
            // One text-only estimate (cached server-side per product), so the
            // user lands on a populated form instead of the 14-day default.
            let averageDuration = 14;
            let category = "Other";
            try {
                const pr = await fetch("/api/predict", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: d.name, brand: d.brand, unit: d.quantity, size: d.quantity, category: "Other" }),
                });
                const pj = await pr.json();
                if (pj.success) {
                    averageDuration = pj.data.averageDuration;
                    category = pj.data.category || "Other";
                }
            } catch { /* keep defaults; user can Re-estimate */ }

            setForm({
                ...emptyForm(),
                name: d.name,
                brand: d.brand || "",
                unit: d.quantity || "units",
                averageDuration,
                category,
                source: "ocr",
                imageUrl,
            });
            setMode("confirm");
        } catch {
            setToast("OCR unavailable — add the product manually.");
            setForm({ ...emptyForm(), source: "ocr", imageUrl: await uploadPromise });
            setMode("manual");
        } finally {
            setLookingUp(false);
        }
    };

    const openManual = () => {
        setForm(emptyForm(`MANUAL-${Date.now()}`));
        setMode("manual");
    };

    // Deterministic id for products with no barcode, so re-adding the same
    // item resolves to one shared catalogue entry instead of a duplicate.
    const slugify = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

    // Re-run the AI estimate using everything the user has filled in / corrected.
    const reestimate = async () => {
        if (!form.name.trim()) {
            setToast("Enter a product name first.");
            return;
        }
        setReestimating(true);
        try {
            const res = await fetch("/api/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: form.name, brand: form.brand, flavor: form.flavor,
                    price: form.price, category: form.category, unit: form.unit, size: form.unit,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setForm((f) => ({ ...f, averageDuration: data.data.averageDuration, category: data.data.category || f.category }));
                setToast(`Updated estimate: ~${data.data.averageDuration} days`);
            } else {
                setToast("Couldn't re-estimate — set it manually.");
            }
        } catch {
            setToast("Couldn't re-estimate — set it manually.");
        } finally {
            setReestimating(false);
        }
    };

    const onImageFile = async (file?: File) => {
        if (!file) return;
        setUploadingImage(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const data = await res.json();
            if (data.success) setForm((f) => ({ ...f, imageUrl: data.url }));
            else setToast(data.message || "Couldn't upload that image.");
        } catch {
            setToast("Couldn't upload that image.");
        } finally {
            setUploadingImage(false);
        }
    };

    const saveProduct = async () => {
        if (!form.name.trim()) {
            setToast("Please enter a product name.");
            return;
        }
        const returnMode: Mode = mode === "manual" ? "manual" : "confirm";
        const productId =
            form.source === "ocr"
                ? `OCR-${slugify([form.brand, form.name, form.unit].filter(Boolean).join(" "))}`
                : form.barcode || `MANUAL-${Date.now()}`;
        setMode("saving");
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    productId,
                    quantity: form.quantity,
                    unit: form.unit || "units",
                    productDetails: {
                        name: form.name.trim(),
                        brand: form.brand.trim(),
                        flavor: form.flavor.trim(),
                        price: form.price.trim(),
                        category: form.category,
                        imageUrl: form.imageUrl,
                        unit: form.unit,
                        averageDuration: Number(form.averageDuration) || 14,
                        addedBy: form.addedBy,
                        source: form.source,
                    },
                }),
            });
            if (!res.ok) throw new Error();
            finish(`${form.name.trim()} added`);
        } catch {
            setToast("Could not add item. Try again.");
            setMode(returnMode);
        }
    };

    const finish = (msg: string) => {
        setMode("done");
        setToast(msg);
        setTimeout(() => router.push("/inventory"), 1100);
    };

    const isConfirm = mode === "confirm";
    const isManual = mode === "manual";

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
                        <p className="kicker mb-3 text-center">Snap · confirm · add</p>
                        <div className="aspect-[3/4] sm:aspect-video w-full ring-1 ring-line rounded-2xl overflow-hidden shadow-xl relative">
                            <PhotoCapture onCapture={handlePhoto} onManual={openManual} onError={(e) => setToast(e)} />
                            {lookingUp && (
                                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                    <Loader2 className="w-10 h-10 animate-spin text-white" />
                                    <p className="mt-3 text-white text-sm font-medium">Reading label…</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {(isConfirm || isManual) && (
                    <div className="pantry-card p-6 rise">
                        <div className="mb-4">
                            <h2 className="font-display text-2xl font-semibold text-ink">
                                {isConfirm ? "Confirm details" : "Add manually"}
                            </h2>
                            <p className="text-sm text-ink-soft mt-1">
                                {isConfirm
                                    ? "Everything's editable — fix anything that's off, then add it."
                                    : !form.barcode || form.barcode.startsWith("MANUAL-")
                                        ? "No barcode — just type the details."
                                        : <>Barcode <span className="font-mono text-ink">{form.barcode}</span> isn’t in any database yet.</>}
                            </p>
                        </div>

                        {/* Editable image */}
                        <div className="flex items-center gap-4 mb-4">
                            <div className="w-24 h-24 rounded-xl bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0 relative">
                                {uploadingImage ? (
                                    <Loader2 className="w-7 h-7 animate-spin text-terracotta" />
                                ) : form.imageUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={form.imageUrl} alt={form.name} className="w-full h-full object-cover" />
                                ) : (
                                    <Package className="w-10 h-10 text-ink-faint" strokeWidth={1.6} />
                                )}
                            </div>
                            <div className="flex flex-col gap-2">
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => onImageFile(e.target.files?.[0])}
                                />
                                <button
                                    type="button"
                                    onClick={() => fileRef.current?.click()}
                                    disabled={uploadingImage}
                                    className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    <ImagePlus className="w-4 h-4" />
                                    {form.imageUrl ? "Replace photo" : "Add photo"}
                                </button>
                                {form.imageUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setForm((f) => ({ ...f, imageUrl: null }))}
                                        className="inline-flex items-center gap-1.5 text-xs text-berry hover:underline"
                                    >
                                        <X className="w-3.5 h-3.5" /> Remove photo
                                    </button>
                                )}
                                {isConfirm && (
                                    <span className="pill bg-olive/10 text-olive w-max">
                                        {form.source === "cache" ? "from your library" : `via ${form.source}`}
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <Field label="Product name *">
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Toned Milk" className={inputCls} />
                            </Field>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Brand">
                                    <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Amul" className={inputCls} />
                                </Field>
                                <Field label="Flavor / variant">
                                    <input value={form.flavor} onChange={(e) => setForm({ ...form, flavor: e.target.value })} placeholder="e.g. Aqua, Mango" className={inputCls} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Size / weight">
                                    <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. 1 L, 150 ml, 500 g" className={inputCls} />
                                </Field>
                                <Field label="Price">
                                    <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. ₹199" className={inputCls} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Category">
                                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </Field>
                                <Field label="Quantity">
                                    <div className="flex items-center gap-3 h-[38px]">
                                        <button onClick={() => setForm((f) => ({ ...f, quantity: Math.max(1, f.quantity - 1) }))} className="w-9 h-9 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2">
                                            <Minus className="w-4 h-4" />
                                        </button>
                                        <span className="w-6 text-center font-semibold text-ink">{form.quantity}</span>
                                        <button onClick={() => setForm((f) => ({ ...f, quantity: f.quantity + 1 }))} className="w-9 h-9 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2">
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    </div>
                                </Field>
                            </div>

                            {/* Duration — the predicted "time taken to consume", editable + re-estimable */}
                            <Field label="Typically lasts">
                                <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-2 flex-1">
                                        <input
                                            type="number"
                                            min={1}
                                            value={form.averageDuration}
                                            onChange={(e) => setForm({ ...form, averageDuration: Math.max(1, +e.target.value || 1) })}
                                            className={inputCls}
                                        />
                                        <span className="text-sm text-ink-soft whitespace-nowrap">days / unit</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={reestimate}
                                        disabled={reestimating}
                                        title="Re-estimate from the details above"
                                        className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap disabled:opacity-50"
                                    >
                                        {reestimating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                        Re-estimate
                                    </button>
                                </div>
                                <span className="block text-xs text-ink-faint mt-1">≈ how long one unit lasts your household. AI-suggested — edit if you know better.</span>
                            </Field>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button onClick={() => setMode("scan")} className="btn-ghost flex-1 py-3">{isConfirm ? "Scan again" : "Cancel"}</button>
                            <button onClick={saveProduct} className="btn-primary flex-1 py-3">Add to inventory</button>
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

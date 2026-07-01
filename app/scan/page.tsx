"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PhotoCapture from "@/components/PhotoCapture";
import { Package, CheckCircle2, Loader2, Minus, Plus, Sparkles, ImagePlus, X, ScanLine } from "lucide-react";
import BackButton from "@/components/BackButton";
import UserMenu from "@/components/UserMenu";
import { toThumb } from "@/lib/clientImage";

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
    averageDuration: number | ""; // "" while the field is being edited/cleared
    perPersonDailyRate?: number; // units/person/day from the predictor — drives forecast re-scaling
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
    return (
        <Suspense fallback={null}>
            <ScanPageInner />
        </Suspense>
    );
}

function ScanPageInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    // Arrived from the shopping list's "Add item" — same manual-entry form,
    // but it creates a shopping-list entry instead of adding to inventory.
    const forShopping = searchParams.get("to") === "shopping";
    const [mode, setMode] = useState<Mode>("scan");
    const [toast, setToast] = useState<string | null>(null);
    const [lookingUp, setLookingUp] = useState(false);
    const [reestimating, setReestimating] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [readingBack, setReadingBack] = useState(false);
    const [form, setForm] = useState<Form>(emptyForm());
    // Fields the structurer flagged low-confidence — shown with a "check" hint.
    const [lowConf, setLowConf] = useState<Set<string>>(new Set());
    const fileRef = useRef<HTMLInputElement>(null);
    const backRef = useRef<HTMLInputElement>(null);
    // Always-current snapshot so async handlers read the latest user edits,
    // not the stale closure value from when the handler was created.
    const formRef = useRef(form);
    formRef.current = form;

    // Jump straight to the manual form, pre-filled with the name typed on the
    // shopping list — skip the camera step (you don't have the item yet).
    useEffect(() => {
        if (forShopping) {
            setForm({ ...emptyForm(`MANUAL-${Date.now()}`), name: searchParams.get("name") || "" });
            setLowConf(new Set());
            setMode("manual");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handlePhoto = async (image: Blob) => {
        setLookingUp(true);
        // Local blob URL shows the photo immediately (before the upload round-trip).
        // Swapped for the server URL once the upload resolves.
        const localPreview = URL.createObjectURL(image);

        const uploadPromise = (async () => {
            try {
                const thumb = await toThumb(image);
                const fd = new FormData();
                fd.append("file", thumb, "label.jpg");
                const r = await fetch("/api/upload", { method: "POST", body: fd });
                const j = await r.json();
                return j.success ? (j.url as string) : null;
            } catch {
                return null;
            }
        })();

        // Called right after setForm so the swap lands on the freshly-set state.
        const finalizeImage = () =>
            uploadPromise.then((url) => {
                URL.revokeObjectURL(localPreview);
                if (url) setForm((f) => ({ ...f, imageUrl: url }));
            });

        try {
            const visRes = await fetch("/api/product-vision", { method: "POST", body: image });
            const vis = await visRes.json();
            const d = vis.data || {};

            if (d.backPanel) {
                const filled = [d.quantity && `size ${d.quantity}`, d.price && `price ${d.price}`].filter(Boolean).join(", ");
                setToast(`Back panel — ${filled ? `${filled} filled in.` : ""} Snap the front for name & brand.`);
                setForm({ ...emptyForm(), unit: d.quantity || "", price: d.price || "", source: "ocr", imageUrl: localPreview });
                finalizeImage();
                setLowConf(new Set());
                setMode("manual");
                return;
            }
            if (!vis.success || !d.name) {
                setToast("Couldn't read the label — type the details and it'll be saved.");
                setForm({ ...emptyForm(), unit: d.quantity || "", price: d.price || "", source: "ocr", imageUrl: localPreview });
                finalizeImage();
                setLowConf(new Set());
                setMode("manual");
                return;
            }
            setForm({
                ...emptyForm(),
                name: d.name,
                brand: d.brand || "",
                flavor: d.flavor || "",
                unit: d.quantity || "",
                price: d.price || "",
                category: d.category && CATEGORIES.includes(d.category) ? d.category : "Other",
                source: "ocr",
                imageUrl: localPreview,
            });
            finalizeImage();
            setLowConf(lowConfFields(d.confidence));
            setMode("confirm");
            void autoEstimate(d);
        } catch {
            setToast("OCR unavailable — add the product manually.");
            setForm({ ...emptyForm(), source: "ocr", imageUrl: localPreview });
            finalizeImage();
            setLowConf(new Set());
            setMode("manual");
        } finally {
            setLookingUp(false);
        }
    };

    const openManual = () => {
        setForm(emptyForm(`MANUAL-${Date.now()}`));
        setLowConf(new Set());
        setMode("manual");
    };

    // Deterministic id for products with no barcode, so re-adding the same
    // item resolves to one shared catalogue entry instead of a duplicate.
    const slugify = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

    // Background estimate right after a scan — patches only duration/category so
    // it never clobbers a field the user started editing. Reuses `reestimating`
    // so the Re-estimate button spins while it runs.
    const autoEstimate = async (d: { name: string; brand?: string; flavor?: string; quantity?: string; category?: string }) => {
        setReestimating(true);
        try {
            const res = await fetch("/api/predict", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: d.name, brand: d.brand, flavor: d.flavor, unit: d.quantity, size: d.quantity, category: d.category || "Other" }),
            });
            const data = await res.json();
            if (data.success) {
                setForm((f) => ({ ...f, averageDuration: data.data.averageDuration, perPersonDailyRate: data.data.perPersonDailyRate, category: data.data.category || f.category }));
            }
        } catch { /* keep defaults; user can Re-estimate */ } finally {
            setReestimating(false);
        }
    };

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
                setForm((f) => ({ ...f, averageDuration: data.data.averageDuration, perPersonDailyRate: data.data.perPersonDailyRate, category: data.data.category || f.category }));
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
        // Show instantly via blob URL; swap to server URL once upload finishes.
        const preview = URL.createObjectURL(file);
        const prevImage = form.imageUrl;
        setForm((f) => ({ ...f, imageUrl: preview }));
        setUploadingImage(true);
        try {
            const fd = new FormData();
            fd.append("file", await toThumb(file), "photo.jpg");
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const data = await res.json();
            URL.revokeObjectURL(preview);
            if (data.success) setForm((f) => ({ ...f, imageUrl: data.url }));
            else { setForm((f) => ({ ...f, imageUrl: prevImage })); setToast(data.message || "Couldn't upload that image."); }
        } catch {
            URL.revokeObjectURL(preview);
            setForm((f) => ({ ...f, imageUrl: prevImage }));
            setToast("Couldn't upload that image.");
        } finally {
            setUploadingImage(false);
        }
    };

    // Optional second shot: back panel has net quantity + MRP even when the
    // front doesn't. Pull both and merge into the form.
    const handleBackPhoto = async (file?: File) => {
        if (!file) return;
        setReadingBack(true);
        try {
            const image = await downscale(file);
            const visRes = await fetch("/api/product-vision?side=back", { method: "POST", body: image });
            const vis = await visRes.json();
            const q = vis.data?.quantity;
            const p = vis.data?.price;
            // The back VLM often returns whole paragraphs (composition, marketing)
            // as "quantity" — accept it only if it actually looks like a net size /
            // price. AND only fill when the front didn't already give a real value,
            // so a correct front read (e.g. "1000 ml") is never clobbered. Fields
            // stay editable for manual override.
            const hasRealUnit = !!form.unit && form.unit.trim().toLowerCase() !== "units";
            const hasPrice = !!form.price.trim();
            const sizeFromBack = looksLikeSize(q) ? q.trim() : undefined;
            const priceFromBack = looksLikePrice(p) ? p.trim() : undefined;
            const applyUnit = !!sizeFromBack && !hasRealUnit;
            const applyPrice = !!priceFromBack && !hasPrice;
            if (!applyUnit && !applyPrice) {
                // Distinguish "guard blocked a valid read" from "read actually failed".
                if (hasRealUnit && sizeFromBack) {
                    setToast("Size already captured from the front — edit the field to override.");
                } else if (hasPrice && priceFromBack) {
                    setToast("Price already set — edit the field to override.");
                } else {
                    setToast(
                        (q || p)
                            ? "Couldn't read a clear size/price on the back — set it manually."
                            : "Couldn't find details on the back — set them manually.",
                    );
                }
                return;
            }
            const nextUnit = applyUnit && sizeFromBack ? sizeFromBack : form.unit;
            const nextPrice = applyPrice && priceFromBack ? priceFromBack : form.price;
            setForm((f) => ({
                ...f,
                ...(applyUnit && sizeFromBack ? { unit: sizeFromBack } : {}),
                ...(applyPrice && priceFromBack ? { price: priceFromBack } : {}),
            }));
            const parts = [
                applyUnit && sizeFromBack && `size ${sizeFromBack}`,
                applyPrice && priceFromBack && `price ${priceFromBack}`,
            ].filter(Boolean).join(", ");

            // Size (and price) are strong signals for shelf life — a 1 L bottle
            // lasts far longer than 200 ml. Refresh the duration estimate with the
            // merged details. Needs a product name; if there's none yet (back-first
            // flow) just fill the fields — the user re-estimates after naming it.
            const latestForm = formRef.current;
            if (latestForm.name.trim()) {
                try {
                    const pr = await fetch("/api/predict", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: latestForm.name, brand: latestForm.brand, flavor: latestForm.flavor,
                            price: nextPrice, category: latestForm.category, unit: nextUnit, size: nextUnit,
                        }),
                    });
                    const pj = await pr.json();
                    if (pj.success) {
                        setForm((f) => ({ ...f, averageDuration: pj.data.averageDuration, perPersonDailyRate: pj.data.perPersonDailyRate, category: pj.data.category || f.category }));
                        setToast(`Back read — ${parts} filled in. Estimate updated: ~${pj.data.averageDuration} days`);
                        return;
                    }
                } catch { /* fall through to the plain confirmation toast */ }
            }
            setToast(`Back read — ${parts} filled in.`);
        } catch {
            setToast("Couldn't read the back photo.");
        } finally {
            setReadingBack(false);
        }
    };

    const saveProduct = async () => {
        if (!form.name.trim()) {
            setToast("Please enter a product name.");
            return;
        }
        const returnMode: Mode = mode === "manual" ? "manual" : "confirm";
        // "units" is the default fallback, not a real size — omit it from the
        // slug so the same product scanned twice (once with size, once without)
        // resolves to the same catalogue entry rather than creating a duplicate.
        const unitPart = form.unit && form.unit.toLowerCase() !== "units" ? form.unit : "";
        const productId =
            form.source === "ocr"
                ? `OCR-${slugify([form.brand, form.name, unitPart].filter(Boolean).join(" "))}`
                : form.barcode || `MANUAL-${Date.now()}`;
        setMode("saving");
        const productDetails = {
            name: form.name.trim(),
            brand: form.brand.trim(),
            flavor: form.flavor.trim(),
            price: form.price.trim(),
            category: form.category,
            imageUrl: form.imageUrl,
            unit: form.unit,
            averageDuration: Number(form.averageDuration) || 14,
            ...(form.perPersonDailyRate ? { perPersonDailyRate: form.perPersonDailyRate } : {}),
            addedBy: form.addedBy,
            source: form.source,
        };
        try {
            const res = forShopping
                ? await fetch("/api/shopping-list", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: form.name.trim(), productDetails }),
                })
                : await fetch("/api/inventory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ productId, quantity: form.quantity, unit: form.unit || "units", productDetails }),
                });
            if (!res.ok) throw new Error();
            finish(`${form.name.trim()} added${forShopping ? " to your shopping list" : ""}`);
        } catch {
            setToast("Could not add item. Try again.");
            setMode(returnMode);
        }
    };

    const finish = (msg: string) => {
        setMode("done");
        setToast(msg);
        // replace, not push: scan is a transient step — drop it from history so
        // back returns to home/shopping, not to the scanner.
        setTimeout(() => router.replace(forShopping ? "/shopping" : "/inventory"), 1100);
    };

    const isConfirm = mode === "confirm";
    const isManual = mode === "manual";

    return (
        <div className="min-h-screen">
            <header className="border-b border-line">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <BackButton />
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink">{forShopping ? "Add to shopping list" : "Add a product"}</h1>
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

                        {/* Optional back shot → auto-fills Size from the net qty. */}
                        <button
                            type="button"
                            onClick={() => backRef.current?.click()}
                            disabled={readingBack}
                            className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm mb-4 disabled:opacity-50"
                        >
                            {readingBack ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                            Scan the back for size
                        </button>
                        <input
                            ref={backRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => handleBackPhoto(e.target.files?.[0])}
                        />

                        <div className="space-y-3">
                            <Field label="Product name *" warn={lowConf.has("name")}>
                                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Toned Milk" className={inputCls} />
                            </Field>
                            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                                <Field label="Brand" warn={lowConf.has("brand")}>
                                    <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="e.g. Amul" className={inputCls} />
                                </Field>
                                <Field label="Flavor / variant" warn={lowConf.has("flavor")}>
                                    <input value={form.flavor} onChange={(e) => setForm({ ...form, flavor: e.target.value })} placeholder="e.g. Aqua, Mango" className={inputCls} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                                <Field label="Size / weight" warn={lowConf.has("size")}>
                                    <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. 1 L, 150 ml, 500 g" className={inputCls} />
                                </Field>
                                <Field label="Price">
                                    <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="e.g. ₹199" className={inputCls} />
                                </Field>
                            </div>
                            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                                <Field label="Category">
                                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls}>
                                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                                    </select>
                                </Field>
                                {/* Not-yet-bought — the shopping list's own stepper decides how
                                    many to buy once you tick it off, not this form. */}
                                {!forShopping && (
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
                                )}
                            </div>

                            {/* Duration — the predicted "time taken to consume", editable + re-estimable */}
                            <Field label="Typically lasts">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center gap-2 flex-1 min-w-[130px]">
                                        <input
                                            type="number"
                                            min={1}
                                            value={form.averageDuration}
                                            // Allow the field to go empty while typing (so you can erase
                                            // the prefilled value and type a new one, e.g. "1"); clamp on blur.
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setForm({ ...form, averageDuration: v === "" ? "" : Math.max(1, parseInt(v, 10) || 1) });
                                            }}
                                            onBlur={() => setForm((f) => ({ ...f, averageDuration: Math.max(1, Number(f.averageDuration) || 14) }))}
                                            className={inputCls}
                                        />
                                        <span className="text-sm text-ink-soft whitespace-nowrap">days / unit</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={reestimate}
                                        disabled={reestimating}
                                        title="Re-estimate from the details above"
                                        className="btn-ghost inline-flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-50"
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
                            <button onClick={saveProduct} className="btn-primary flex-1 py-3">{forShopping ? "Add to shopping list" : "Add to inventory"}</button>
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
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 max-w-[90vw] text-center bg-ink text-paper text-sm px-4 py-2 rounded-full shadow-lg">
                        {toast}
                        <button onClick={() => setToast(null)} className="ml-3 text-paper/60 hover:text-paper">✕</button>
                    </div>
                )}
            </main>
        </div>
    );
}

// Raw camera files can exceed the OCR 12MB cap; shrink to the same 1600px the
// live capture uses before sending. (PhotoCapture downscales its own frames.)
async function downscale(file: File, maxEdge = 1600): Promise<Blob> {
    try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        const ctx = c.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
    } catch {
        return file;
    }
}

// Guards for back-panel reads. A real net quantity is short and is a number
// followed by a unit; a real price has a currency marker. Anything longer or
// without that shape is the VLM dumping composition/marketing text — reject it.
const SIZE_RE = /\b\d+(\.\d+)?\s?(ml|l|ltr|litre|liter|cl|kg|g|gm|gms|gram|grams|mg|pcs?|pieces?|x|n|units?|caps?|capsules?|tablets?|sachets?)\b/i;
const PRICE_RE = /(₹|rs\.?|inr|mrp)\s?\d|\d\s?(₹|rs\.?|\/-)/i;
const looksLikeSize = (s?: string): s is string => !!s && s.trim().length <= 24 && SIZE_RE.test(s);
const looksLikePrice = (s?: string): s is string => !!s && s.trim().length <= 24 && PRICE_RE.test(s);

const inputCls = "w-full px-3 py-2 rounded-lg border border-line-strong bg-card focus:ring-2 focus:ring-primary/30 focus:border-primary outline-none text-sm text-ink placeholder:text-ink-faint";

// Map the structurer's per-field confidence to the set of fields to flag.
type FieldConf = { brand?: string; name?: string; flavor?: string; size?: string };
const lowConfFields = (c?: FieldConf): Set<string> => {
    const s = new Set<string>();
    (["brand", "name", "flavor", "size"] as const).forEach((k) => { if (c?.[k] === "low") s.add(k); });
    return s;
};

function Field({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="block text-xs font-semibold text-ink-soft mb-1">
                {label}
                {warn && <span className="ml-1.5 text-[10px] font-medium text-amber" title="Low confidence — please double-check">● check</span>}
            </span>
            {children}
        </label>
    );
}

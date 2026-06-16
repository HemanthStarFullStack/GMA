"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Users, Loader2, Check, Trash2, Sparkles } from "lucide-react";

export default function SettingsPage() {
    const [familySize, setFamilySize] = useState(1);
    const [surveyFrequency, setSurveyFrequency] = useState<"always" | "occasional">("occasional");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/user");
                const data = await res.json();
                if (data.success) {
                    setFamilySize(data.data.familySize ?? 1);
                    setSurveyFrequency(data.data.surveyFrequency ?? "occasional");
                }
            } catch {
                /* keep defaults */
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        try {
            const res = await fetch("/api/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ familySize, surveyFrequency }),
            });
            if (res.ok) {
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            }
        } finally {
            setSaving(false);
        }
    };

    const clearDemo = async () => {
        if (!confirm("Remove all demo products and history? Your own scanned items stay.")) return;
        setClearing(true);
        setMsg(null);
        try {
            const res = await fetch("/api/demo", { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                const r = data.removed;
                setMsg(`Removed ${r.inventory} demo items, ${r.products} products and ${r.logs} history entries.`);
            } else {
                setMsg("Nothing to clear.");
            }
        } catch {
            setMsg("Could not clear demo data.");
        } finally {
            setClearing(false);
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
                    <h1 className="font-display text-2xl font-semibold text-ink">Settings</h1>
                    <div className="w-10" />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8 max-w-lg space-y-6">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-terracotta" /></div>
                ) : (
                    <>
                        {/* Household */}
                        <section className="pantry-card overflow-hidden rise">
                            <div className="p-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 bg-olive/10 rounded-full flex items-center justify-center">
                                        <Users className="w-5 h-5 text-olive" />
                                    </div>
                                    <div>
                                        <h2 className="font-display text-xl font-semibold text-ink">Household</h2>
                                        <p className="text-sm text-ink-soft">Tunes your consumption predictions</p>
                                    </div>
                                </div>

                                <label className="block text-sm font-semibold text-ink-soft mb-2">Family size</label>
                                <div className="flex items-center gap-4">
                                    <button onClick={() => setFamilySize(Math.max(1, familySize - 1))} className="w-10 h-10 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2 text-lg">−</button>
                                    <span className="font-display text-2xl font-semibold w-8 text-center text-ink">{familySize}</span>
                                    <button onClick={() => setFamilySize(Math.min(20, familySize + 1))} className="w-10 h-10 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2 text-lg">+</button>
                                </div>

                                <label className="block text-sm font-semibold text-ink-soft mt-6 mb-2">Consumption survey</label>
                                <div className="flex gap-2">
                                    {(["occasional", "always"] as const).map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => setSurveyFrequency(opt)}
                                            className={`flex-1 py-2 px-3 rounded-lg border text-sm font-semibold capitalize transition ${surveyFrequency === opt ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-line-strong text-ink-soft hover:border-ink-faint"}`}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-paper-2/60 px-6 py-4 flex justify-end border-t border-line">
                                <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                                    {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                                </button>
                            </div>
                        </section>

                        {/* Demo data */}
                        <section className="pantry-card p-6 rise" style={{ animationDelay: "80ms" }}>
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-amber/15 rounded-full flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-amber" />
                                </div>
                                <div>
                                    <h2 className="font-display text-xl font-semibold text-ink">Demo data</h2>
                                    <p className="text-sm text-ink-soft">Sample household loaded on your first visit</p>
                                </div>
                            </div>
                            <p className="text-sm text-ink-soft mb-4">
                                Done exploring? Clear the sample products and history to start fresh with your own items.
                            </p>
                            <button onClick={clearDemo} disabled={clearing} className="inline-flex items-center gap-2 border border-berry/30 text-berry px-4 py-2 rounded-full font-semibold hover:bg-berry/5 disabled:opacity-50">
                                {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                Clear demo data
                            </button>
                            {msg && <p className="text-sm text-ink-soft mt-3">{msg}</p>}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}

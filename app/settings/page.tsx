"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Save, Users, Loader2, Check, User as UserIcon, Camera } from "lucide-react";
import BackButton from "@/components/BackButton";

export default function SettingsPage() {
    const { update } = useSession();
    const [name, setName] = useState("");
    const [image, setImage] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const [familySize, setFamilySize] = useState(1);
    const [surveyFrequency, setSurveyFrequency] = useState<"always" | "occasional">("occasional");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/user");
                const data = await res.json();
                if (data.success) {
                    setName(data.data.name ?? "");
                    setImage(data.data.image ?? null);
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

    const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const data = await res.json();
            if (data.success) setImage(data.url);
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const setSize = (n: number) => setFamilySize(Math.max(1, Math.min(20, n)));

    const handleSave = async () => {
        setSaving(true);
        setSaved(false);
        setNote(null);
        try {
            const res = await fetch("/api/user", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ familySize, surveyFrequency, name, image }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                // Push the new name/photo into the session JWT so the header avatar
                // and menu update without a re-login.
                await update({ name, image });
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
                const n = data?.data?.reestimating ?? 0;
                if (n > 0) {
                    setNote(`Re-estimating shelf-life for ${n} item${n === 1 ? "" : "s"} based on a household of ${familySize}. Your forecasts will update shortly.`);
                }
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen">
            <header className="bg-paper/85 backdrop-blur border-b border-line sticky top-0 z-10">
                <div className="container mx-auto px-5 py-4 flex items-center justify-between">
                    <BackButton />
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink">Settings</h1>
                    <div className="w-10" />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8 max-w-lg space-y-6">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-terracotta" /></div>
                ) : (
                    <>
                        {/* Profile */}
                        <section className="pantry-card overflow-hidden rise">
                            <div className="p-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 bg-terracotta/10 rounded-full flex items-center justify-center">
                                        <UserIcon className="w-5 h-5 text-terracotta" />
                                    </div>
                                    <div>
                                        <h2 className="font-display text-xl font-semibold text-ink">Profile</h2>
                                        <p className="text-sm text-ink-soft">Your name and photo</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-5">
                                    <button
                                        type="button"
                                        onClick={() => fileRef.current?.click()}
                                        className="relative group shrink-0"
                                        title="Change photo"
                                    >
                                        {image ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={image} alt="Profile" className="w-20 h-20 rounded-full object-cover border border-line bg-card" />
                                        ) : (
                                            <div className="w-20 h-20 rounded-full bg-olive/10 flex items-center justify-center text-olive border border-olive/20">
                                                <UserIcon className="w-8 h-8" />
                                            </div>
                                        )}
                                        <span className="absolute inset-0 rounded-full bg-ink/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                                            {uploading ? <Loader2 className="w-6 h-6 text-paper animate-spin" /> : <Camera className="w-6 h-6 text-paper" />}
                                        </span>
                                    </button>
                                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />

                                    <div className="flex-1 min-w-0">
                                        <label className="block text-sm font-semibold text-ink-soft mb-2">Name</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={(e) => setName(e.target.value)}
                                            maxLength={60}
                                            placeholder="Your name"
                                            className="w-full px-3 py-2 rounded-lg border border-line-strong bg-paper text-ink focus:outline-none focus:border-terracotta"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-paper-2/60 px-6 py-4 flex justify-end border-t border-line">
                                <button onClick={handleSave} disabled={saving || uploading} className="btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50">
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                                    {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                                </button>
                            </div>
                        </section>

                        {/* Household */}
                        <section data-tour="settings-family" className="pantry-card overflow-hidden rise">
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
                                    <button onClick={() => setSize(familySize - 1)} className="w-10 h-10 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2 text-lg">−</button>
                                    <span className="font-display text-2xl font-semibold w-8 text-center text-ink">{familySize}</span>
                                    <button onClick={() => setSize(familySize + 1)} className="w-10 h-10 rounded-full border border-line-strong flex items-center justify-center hover:bg-paper-2 text-lg">+</button>
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

                        {note && (
                            <p className="text-sm text-olive bg-olive/10 border border-olive/20 rounded-xl px-4 py-3 rise">{note}</p>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}

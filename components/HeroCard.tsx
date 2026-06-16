"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, Package, Camera } from "lucide-react";
import Link from "next/link";

export type HeroItem = {
    name: string;
    brand: string;
    quantity: number;
    unit: string;
    daysLeft: number;
};

function urgencyColor(days: number) {
    if (days <= 3) return { bar: "bg-terracotta", label: "text-terracotta", badge: "Running low" };
    if (days <= 7) return { bar: "bg-amber",      label: "text-amber",      badge: "Getting low" };
    return              { bar: "bg-olive",         label: "text-olive",      badge: "Well stocked" };
}

function StockBar({ daysLeft }: { daysLeft: number }) {
    const pct = Math.max(5, Math.min(100, Math.round((daysLeft / 30) * 100)));
    const { bar } = urgencyColor(daysLeft);
    return (
        <div className="mt-5 h-2 rounded-full bg-paper-2 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

function restockLabel(daysLeft: number): string {
    if (daysLeft <= 0) return "restock now";
    const d = new Date();
    d.setDate(d.getDate() + daysLeft);
    return `restock by ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
}

// ── Guest teaser (not logged in) ─────────────────────────────────────────────
function GuestCard() {
    return (
        <div className="pantry-card p-7 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-paper-2" />
            <div className="relative">
                <div className="flex items-center gap-2 text-terracotta">
                    <Sparkles className="w-4 h-4" />
                    <span className="kicker text-terracotta">Running low</span>
                </div>
                <p className="mt-4 font-display text-4xl font-semibold text-ink">Toned Milk</p>
                <p className="text-ink-soft">Amul · 1 packet left</p>
                <StockBar daysLeft={3} />
                <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-terracotta font-semibold">~3 days left</span>
                    <span className="text-ink-faint">restock by Thu</span>
                </div>
                <Link href="/login" className="mt-5 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-ink underline underline-offset-2">
                    Sign in to see your pantry →
                </Link>
            </div>
        </div>
    );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyCard() {
    return (
        <div className="pantry-card p-7 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-paper-2" />
            <div className="relative flex flex-col items-start gap-4">
                <Package className="w-10 h-10 text-ink-faint" strokeWidth={1.4} />
                <div>
                    <p className="font-display text-2xl font-semibold text-ink">Your pantry is empty</p>
                    <p className="text-ink-soft mt-1 text-sm">Scan your first item to start tracking.</p>
                </div>
                <Link href="/scan" className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm">
                    <Camera className="w-4 h-4" /> Scan a product
                </Link>
            </div>
        </div>
    );
}

// ── Live item card ────────────────────────────────────────────────────────────
function ItemCard({ item }: { item: HeroItem }) {
    const { label, badge } = urgencyColor(item.daysLeft);
    return (
        <div className="relative">
            <div className={`flex items-center gap-2 ${label}`}>
                <Sparkles className="w-4 h-4" />
                <span className={`kicker ${label}`}>{badge}</span>
            </div>
            <p
                className="mt-4 font-display text-4xl font-semibold text-ink leading-tight truncate"
                title={item.name}
            >
                {item.name}
            </p>
            <p className="text-ink-soft truncate">
                {item.brand || "—"}
            </p>
            <StockBar daysLeft={item.daysLeft} />
            <div className="mt-3 flex items-center justify-between text-sm">
                <span className={`font-semibold ${urgencyColor(item.daysLeft).label}`}>
                    {item.daysLeft <= 0 ? "Out of stock" : `~${item.daysLeft} day${item.daysLeft !== 1 ? "s" : ""} left`}
                </span>
                <span className="text-ink-faint">{restockLabel(item.daysLeft)}</span>
            </div>
        </div>
    );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function HeroCard({ items, isGuest }: { items: HeroItem[]; isGuest: boolean }) {
    const [idx, setIdx] = useState(0);
    const pauseRef = useRef(false);

    useEffect(() => {
        if (items.length <= 1) return;
        const t = setInterval(() => {
            if (!pauseRef.current) setIdx((i) => (i + 1) % items.length);
        }, 4000);
        return () => clearInterval(t);
    }, [items.length]);

    if (isGuest) return <GuestCard />;
    if (items.length === 0) return <EmptyCard />;

    return (
        <div
            className="pantry-card p-7 relative overflow-hidden"
            onMouseEnter={() => { pauseRef.current = true; }}
            onMouseLeave={() => { pauseRef.current = false; }}
        >
            <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-paper-2" />
            <div className="relative">
                <ItemCard item={items[idx]} />

                {items.length > 1 && (
                    <div className="mt-5 flex items-center gap-2">
                        {items.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setIdx(i)}
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                    i === idx ? "w-6 bg-ink" : "w-1.5 bg-line-strong"
                                }`}
                                aria-label={`Show item ${i + 1}`}
                            />
                        ))}
                        <Link href="/inventory" className="ml-auto text-xs text-ink-faint hover:text-ink underline-offset-2 hover:underline">
                            View all →
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
}

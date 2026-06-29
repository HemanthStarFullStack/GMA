"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingCart, ArrowRight } from "lucide-react";

export default function ShoppingTile() {
    const [count, setCount] = useState<number | null>(null);

    const load = () => {
        fetch("/api/shopping-list?count=1", { cache: "no-store" })
            .then((r) => r.json())
            .then((d) => { if (d.success) setCount(d.count); })
            .catch(() => {});
    };

    useEffect(() => {
        load();
        // Re-fetch when the page is restored from bfcache (back/forward nav).
        const onShow = (e: PageTransitionEvent) => { if (e.persisted) load(); };
        window.addEventListener("pageshow", onShow);
        return () => window.removeEventListener("pageshow", onShow);
    }, []);

    const n = count ?? 0;

    return (
        <Link
            href="/shopping"
            data-tour="home-shopping"
            className={`pantry-card p-4 flex items-center gap-4 group hover:-translate-y-0.5 transition-transform rise ${n > 0 ? "border-terracotta/40 bg-terracotta/[0.04]" : ""}`}
            style={{ animationDelay: "160ms" }}
        >
            <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${n > 0 ? "bg-terracotta/15 text-terracotta" : "bg-paper-2 text-ink-soft"}`}>
                <ShoppingCart className="w-6 h-6" strokeWidth={1.6} />
            </div>
            <div className="flex-1 min-w-0">
                <h3 className="font-display text-lg font-semibold text-ink">Shopping list</h3>
                <p className="text-xs text-ink-soft">
                    {n > 0 ? `${n} item${n === 1 ? "" : "s"} to restock` : "What to buy"}
                </p>
            </div>
            {n > 0 && (
                <span className="pill bg-terracotta text-paper font-semibold">{n}</span>
            )}
            <ArrowRight className="w-5 h-5 text-ink-faint group-hover:text-ink transition-colors flex-shrink-0" />
        </Link>
    );
}

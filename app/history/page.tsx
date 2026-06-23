"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, History as HistoryIcon, Loader2, Package, Check, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import UserMenu from "@/components/UserMenu";

type ReaddState = "idle" | "loading" | "done";

export default function HistoryPage() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [readd, setReadd] = useState<Record<string, ReaddState>>({});

    useEffect(() => {
        fetchHistory();
    }, []);

    const buyAgain = async (logId: string, productId: string) => {
        if (readd[logId] === "loading" || readd[logId] === "done") return;
        setReadd((s) => ({ ...s, [logId]: "loading" }));
        try {
            const res = await fetch("/api/inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId }),
            });
            const data = await res.json();
            setReadd((s) => ({ ...s, [logId]: data.success ? "done" : "idle" }));
        } catch {
            setReadd((s) => ({ ...s, [logId]: "idle" }));
        }
    };

    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            if (data.success) setLogs(data.data);
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setLoading(false);
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
                    <h1 className="font-display text-xl sm:text-2xl font-semibold text-ink">History</h1>
                    <UserMenu />
                </div>
            </header>

            <main className="container mx-auto px-5 py-8 max-w-2xl">
                {loading ? (
                    <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-terracotta" /></div>
                ) : logs.length === 0 ? (
                    <div className="text-center py-16 rise">
                        <div className="w-16 h-16 bg-paper-2 border border-line rounded-full flex items-center justify-center mx-auto mb-4">
                            <HistoryIcon className="w-8 h-8 text-ink-faint" />
                        </div>
                        <h3 className="font-display text-2xl font-semibold text-ink mb-2">No history yet</h3>
                        <p className="text-ink-soft">Items you mark as consumed will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {logs.map((log: any, i: number) => (
                            <div key={log._id} className="pantry-card overflow-hidden rise" style={{ animationDelay: `${i * 40}ms` }}>
                                <div className="flex gap-3 p-4 items-center">
                                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-paper-2 border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                                        {log.productDetails?.imageUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={log.productDetails.imageUrl} alt={log.productDetails.name} className="w-full h-full object-cover" />
                                        ) : (
                                            <Package className="w-7 h-7 text-ink-faint" strokeWidth={1.6} />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {log.productDetails?.brand && <p className="kicker truncate">{log.productDetails.brand}</p>}
                                        <h3 className="font-display text-lg font-semibold text-ink truncate">
                                            {log.productDetails?.name || `Product ${log.productId.slice(0, 8)}`}
                                        </h3>
                                        <div className="mt-1 flex items-center gap-3 text-sm">
                                            <span className="text-ink-faint">{format(new Date(log.consumedDate), 'MMM d, yyyy')}</span>
                                            <span className="pill bg-olive/10 text-olive">Lasted {log.durationDays} days</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => buyAgain(log._id, log.productId)}
                                        disabled={readd[log._id] === "loading" || readd[log._id] === "done"}
                                        className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${readd[log._id] === "done" ? "text-olive bg-olive/10" : "text-terracotta hover:bg-terracotta/5 disabled:opacity-50"}`}
                                    >
                                        {readd[log._id] === "loading" ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : readd[log._id] === "done" ? (
                                            <Check className="w-4 h-4" />
                                        ) : (
                                            <RotateCcw className="w-4 h-4" />
                                        )}
                                        {readd[log._id] === "done" ? "Added" : "Buy again"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

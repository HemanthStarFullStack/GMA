"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Real "back": return to the previous page in history, not a hard-coded home
// link. Falls back to `fallback` (default home) when there's no history to pop —
// e.g. the page was opened directly from a fresh tab or a deep link.
export default function BackButton({ fallback = "/" }: { fallback?: string }) {
    const router = useRouter();
    const onBack = () => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallback);
    };
    return (
        <button type="button" onClick={onBack} className="flex items-center gap-2 text-ink-soft hover:text-ink">
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Back</span>
        </button>
    );
}

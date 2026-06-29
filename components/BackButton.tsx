"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// Hub-and-spoke app: every page hangs off home, so "back" means go to `fallback`
// (home by default), NOT retrace real history. router.back() could land the user
// on a transient page — e.g. /scan after scan → inventory left it in history.
export default function BackButton({ fallback = "/" }: { fallback?: string }) {
    const router = useRouter();
    return (
        <button type="button" onClick={() => router.push(fallback)} className="flex items-center gap-2 text-ink-soft hover:text-ink">
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">Back</span>
        </button>
    );
}

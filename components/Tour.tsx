"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { getPhase, setPhase, isTourDone, markTourDone, type TourPhase } from "@/lib/tour-state";

const PHASE_PATHS: Record<TourPhase, string> = {
    home: "/",
    inventory: "/inventory",
    shopping: "/shopping",
    analytics: "/analytics",
    history: "/history",
    settings: "/settings",
};

const NEXT_PHASE: Partial<Record<TourPhase, TourPhase>> = {
    home: "inventory",
    inventory: "shopping",
    shopping: "analytics",
    analytics: "history",
    history: "settings",
};

const cleanup = async () => {
    await fetch("/api/user", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourCompleted: true }),
    }).catch(() => {});
    await fetch("/api/demo", { method: "DELETE" }).catch(() => {});
};

export default function GmaTour() {
    const { status } = useSession();
    const pathname = usePathname();
    const router = useRouter();
    const dRef = useRef<ReturnType<typeof driver> | null>(null);
    const runId = useRef(0);

    useEffect(() => {
        if (status !== "authenticated") return;

        const id = ++runId.current;

        const run = async () => {
            let phase = getPhase();

            // Detect first-time user (triggers on / or /inventory — whichever they land on first)
            if (!phase && !isTourDone() && (pathname === "/" || pathname === "/inventory")) {
                try {
                    const res = await fetch("/api/user");
                    if (runId.current !== id) return;
                    const json = await res.json();
                    if (json?.data?.tourCompleted) { markTourDone(); return; }
                    // Seed demo data async — will be ready long before user reaches /inventory in tour
                    fetch("/api/demo", { method: "POST" }).catch(() => {});
                    setPhase("home");
                    phase = "home";
                    // If we landed on inventory first, bounce to home to start the tour there
                    if (pathname !== "/") { router.push("/"); return; }
                } catch { return; }
            }

            if (!phase) return;
            if (PHASE_PATHS[phase] !== pathname) return;
            if (runId.current !== id) return;

            // Wait for DOM to settle after page transition
            await new Promise(r => setTimeout(r, 900));
            if (runId.current !== id) return;

            const has = (sel: string) => !!document.querySelector(sel);
            const p: TourPhase = phase; // capture for closures

            const end = (skip: boolean) => {
                if (runId.current !== id) return;
                dRef.current = null;
                if (skip) { markTourDone(); cleanup(); return; }
                const next = NEXT_PHASE[p];
                if (next) { setPhase(next); router.push(PHASE_PATHS[next]); }
                else { markTourDone(); cleanup(); }
            };

            const stepsMap: Record<TourPhase, object[]> = {
                home: [
                    { popover: { title: "Welcome to GMA 👋", description: "Your household grocery tracker. We've loaded sample products — here's a quick tour of every page." } },
                    ...(has('[data-tour="hero"]') ? [{ element: '[data-tour="hero"]', popover: { title: "Know your kitchen", description: "Scan groceries, track your pantry, and get predictions before you run out." } }] : []),
                    ...(has('[data-tour="home-shopping"]') ? [{ element: '[data-tour="home-shopping"]', popover: { title: "Shopping list", description: "Items running low auto-appear here. GMA keeps your list in sync — you just tick things off." } }] : []),
                    ...(has('[data-tour="home-tiles"]') ? [{ element: '[data-tour="home-tiles"]', popover: { title: "All your tools", description: "Inventory, Analytics, History, and Settings. We'll visit each one now." } }] : []),
                    { popover: { title: "First stop: Inventory →", description: "Heading to your pantry with the sample data loaded." } },
                ],
                inventory: [
                    ...(has("#tour-grid") ? [{ element: "#tour-grid", popover: { title: "Your pantry shelves", description: "Products grouped by category — Staples, Fresh, Snacks, and more. These are sample products." } }] : []),
                    ...(has('[data-tour="adjust"]') ? [{ element: '[data-tour="adjust"]', popover: { title: "Adjust pack count", description: "Got a new pack? Hit +. Used one? Hit −. The last − triggers the consume flow." } }] : []),
                    ...(has('[data-tour="consume"]') ? [{ element: '[data-tour="consume"]', popover: { title: "Mark consumed", description: "GMA learns how fast your household uses each product — this is how forecasts get accurate." } }] : []),
                    ...(has('[data-tour="search"]') ? [{ element: '[data-tour="search"]', popover: { title: "Search & filter", description: "Search by name or brand, sort by quantity, or filter to one shelf section." } }] : []),
                    { popover: { title: "Next: Shopping list →", description: "Atta and Tea are out of stock — they've auto-filled your list." } },
                ],
                shopping: [
                    { popover: { title: "Shopping list", description: "Atta and Tea ran out — GMA added them automatically. The list stays in sync as you buy and use things." } },
                    ...(has('[data-tour="shop-add"]') ? [{ element: '[data-tour="shop-add"]', popover: { title: "Add anything manually", description: "Need something GMA doesn't track yet? Type it here and check it off at the store." } }] : []),
                    { popover: { title: "Next: Analytics →", description: "Let's see your run-out forecasts." } },
                ],
                analytics: [
                    ...(has('[data-tour="analytics-list"]') ? [{ element: '[data-tour="analytics-list"]', popover: { title: "All products", description: "Every product you've tracked with its consumption history. Select one to see its forecast." } }] : []),
                    ...(has('[data-tour="analytics-detail"]') ? [{ element: '[data-tour="analytics-detail"]', popover: { title: "Run-out forecast", description: "Consumption rate, days until empty, and estimated restock date — based on your actual usage." } }] : []),
                    { popover: { title: "Next: History →", description: "Let's see your consumption log." } },
                ],
                history: [
                    ...(has('[data-tour="history-items"]') ? [{ element: '[data-tour="history-items"]', popover: { title: "Consumption log", description: "Every pack you've finished, with how long it lasted. This is what builds your forecasts." } }] : []),
                    ...(has('[data-tour="buy-again"]') ? [{ element: '[data-tour="buy-again"]', popover: { title: "Buy again", description: "Bought something again? One tap re-adds to inventory — no re-scanning needed." } }] : []),
                    { popover: { title: "Last stop: Settings →", description: "One setting that makes every forecast more accurate." } },
                ],
                settings: [
                    ...(has('[data-tour="settings-family"]') ? [{ element: '[data-tour="settings-family"]', popover: { title: "Household size", description: "Tell GMA how many people live here — it scales every prediction to your family's actual pace." } }] : []),
                    { popover: { title: "You're all set! 🎉", description: "Clearing the sample data now. Scan your first real product to get started." } },
                ],
            };

            const steps = stepsMap[p];
            if (!steps?.length) return;
            if (runId.current !== id) return;

            let skipped = false;
            const d = driver({
                showProgress: true,
                allowClose: true,
                popoverClass: "driverjs-theme",
                overlayColor: "#2a2420",
                nextBtnText: "Next",
                prevBtnText: "Back",
                doneBtnText: NEXT_PHASE[p] ? "Continue →" : "Start fresh →",
                steps,
                onCloseClick: () => { skipped = true; },
                onDestroyed: () => end(skipped),
            });
            dRef.current = d;
            d.drive();
        };

        run();

        return () => {
            runId.current++;
            const d = dRef.current;
            dRef.current = null;
            try { d?.destroy(); } catch { /* noop */ }
        };
    }, [pathname, status, router]);

    return null;
}

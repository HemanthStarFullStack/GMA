"use client";

import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

/**
 * New-user guided tour. Runs once (gated by the caller on `run`), highlighting
 * the key surfaces using the seeded demo data. When the user finishes or skips,
 * `onFinish` fires so the caller can clear the demo data and mark the tour done.
 */
export default function Tour({ run, onFinish }: { run: boolean; onFinish: () => void }) {
    const started = useRef(false);

    useEffect(() => {
        if (!run || started.current) return;
        started.current = true;

        const has = (sel: string) => !!document.querySelector(sel);
        const steps: any[] = [
            {
                popover: {
                    title: "Welcome to GMA 👋",
                    description: "We've loaded a sample pantry so you can see it in action. Here's a quick 30-second tour.",
                },
            },
        ];
        if (has("#tour-grid")) steps.push({ element: "#tour-grid", popover: { title: "Your inventory", description: "Everything you have at home, at a glance." } });
        if (has('[data-tour="consume"]')) steps.push({ element: '[data-tour="consume"]', popover: { title: "Mark things consumed", description: "Run out of something? Mark it consumed — GMA learns how fast you use it." } });
        if (has("#tour-analytics")) steps.push({ element: "#tour-analytics", popover: { title: "Run-out forecasts", description: "Analytics turns your habits into predictions, so you restock before you're empty." } });
        if (has("#tour-scan")) steps.push({ element: "#tour-scan", popover: { title: "Add your own", description: "Scan a barcode or add manually — new products are remembered for next time." } });
        steps.push({
            popover: {
                title: "You're all set!",
                description: "We'll clear the sample data now so you can start your own pantry.",
            },
        });

        const d = driver({
            showProgress: true,
            allowClose: true,
            popoverClass: "driverjs-theme",
            overlayColor: "#2a2420",
            nextBtnText: "Next",
            prevBtnText: "Back",
            doneBtnText: "Start fresh →",
            steps,
            onDestroyed: () => onFinish(),
        });
        d.drive();

        return () => {
            try { d.destroy(); } catch { /* noop */ }
        };
    }, [run, onFinish]);

    return null;
}

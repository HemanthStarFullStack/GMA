"use client";

import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

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
                    description: "We've loaded a sample pantry. Here's a 60-second tour of everything the app can do.",
                },
            },
        ];

        if (has("#tour-grid")) steps.push({
            element: "#tour-grid",
            popover: {
                title: "Your pantry shelves",
                description: "Products grouped by category — Staples, Fresh, Snacks, Drinks, and more.",
            },
        });

        if (has('[data-tour="adjust"]')) steps.push({
            element: '[data-tour="adjust"]',
            popover: {
                title: "Adjust pack count",
                description: "− / + tweaks how many you have without marking anything consumed. Hit − on the last pack and GMA asks how long it lasted.",
            },
        });

        if (has('[data-tour="consume"]')) steps.push({
            element: '[data-tour="consume"]',
            popover: {
                title: "Mark consumed",
                description: "When a pack is finished, mark it here. GMA learns how long each product lasts your household and uses that to predict when you'll run out.",
            },
        });

        if (has('[data-tour="search"]')) steps.push({
            element: '[data-tour="search"]',
            popover: {
                title: "Search & filter",
                description: "Search by name or brand. Sort by quantity, date, or name. Filter to one shelf — Staples only, Frozen only, etc.",
            },
        });

        if (has('[data-tour="shopping"]')) steps.push({
            element: '[data-tour="shopping"]',
            popover: {
                title: "Shopping list",
                description: "Items running low auto-appear here. Check 'got it' at the store and they're added back to inventory automatically. Add anything else manually too.",
            },
        });

        if (has("#tour-analytics")) steps.push({
            element: "#tour-analytics",
            popover: {
                title: "Run-out forecasts",
                description: "Analytics turns your consumption history into predictions — see days-until-empty and estimated restock date for every product.",
            },
        });

        if (has("#tour-scan")) steps.push({
            element: "#tour-scan",
            popover: {
                title: "Add a product",
                description: "Snap a label photo — GMA reads name, brand, and size automatically. Or add manually. Products are saved to your library for next time.",
            },
        });

        steps.push({
            popover: {
                title: "Two more things",
                description: "History logs every consumed item — tap 'Buy again' to re-add in one tap. Settings lets you set household size so forecasts match how fast your family actually uses things.",
            },
        });

        steps.push({
            popover: {
                title: "You're all set!",
                description: "We'll clear the sample data now. Start by scanning your first real product.",
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

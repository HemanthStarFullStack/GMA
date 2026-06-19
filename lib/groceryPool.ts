// Authoritative pool of grocery PRODUCT terms (see scripts/build-grocery-pool.mjs).
// Used to tell product name from brand: a line containing a pool term is the
// product; the leftover prominent line is the brand. Brands aren't a fixed set,
// but products are — so we match the product, not the brand.
import POOL from "./grocery-pool.json";

const SET = new Set(POOL as string[]);

// Returns the matched grocery term if `line` contains one (1–3 word window,
// longest first), else null. Word-boundary, case-insensitive.
export function findProductTerm(line: string): string | null {
    const w = line.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let n = Math.min(3, w.length); n >= 1; n--) {
        for (let i = 0; i + n <= w.length; i++) {
            const g = w.slice(i, i + n).join(" ");
            if (SET.has(g)) return g;
        }
    }
    return null;
}

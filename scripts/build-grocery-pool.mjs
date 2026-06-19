// Regenerates lib/grocery-pool.json — the authoritative pool of grocery PRODUCT
// terms used to tell the product name apart from the brand (a token in the pool
// is the product; the leftover prominent text is the brand).
//
// Source: Open Food Facts category taxonomies (food + beauty), which are open,
// crowd-built, and carry regional synonyms (atta, paneer, dal...). Products are
// a small, stable vocabulary; brands are not — so we match the product.
//
// Run: node scripts/build-grocery-pool.mjs
import { writeFileSync } from "node:fs";

const SOURCES = [
    "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/food/categories.txt",
    "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/beauty/categories.txt",
];

// Words too generic to identify a product on their own — dropped so they can't
// match a brand line by accident.
const STOP = new Set("and with the for of in no natural organic fresh other products product food foods based made from style plain whole powder mix ready instant baby babies".split(" "));

// Personal-care / household terms — thin in the OFF beauty taxonomy, so seeded.
const NON_FOOD = [
    "shampoo", "conditioner", "toothpaste", "toothbrush", "soap", "handwash", "face wash",
    "body wash", "deodorant", "body spray", "perfume", "lotion", "moisturizer", "sunscreen",
    "hair oil", "shaving cream", "razor", "sanitary pad", "diaper", "detergent", "washing powder",
    "dishwash", "floor cleaner", "toilet cleaner", "phenyl", "tissue", "toilet paper", "napkin",
    "sanitizer", "agarbatti", "mosquito repellent",
];

const pool = new Set();
const add = (s) => {
    s = s.toLowerCase().trim().replace(/[^a-z&'\-\s]/g, " ").replace(/\s+/g, " ").trim();
    if (s.length >= 3 && !STOP.has(s)) pool.add(s);
};

for (const url of SOURCES) {
    const txt = await (await fetch(url)).text();
    for (const line of txt.split("\n")) {
        const m = line.match(/^en:\s*(.+)$/);
        if (!m) continue;
        for (let syn of m[1].split(",")) {
            syn = syn.toLowerCase().trim();
            if (/\d/.test(syn)) continue;
            add(syn); // full phrase, e.g. "rolled oats"
            const w = syn.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
            if (w.length) add(w[w.length - 1]); // English head noun, e.g. "oats"
        }
    }
}
for (const t of NON_FOOD) add(t);

const arr = [...pool].sort();
writeFileSync(new URL("../lib/grocery-pool.json", import.meta.url), JSON.stringify(arr));
console.log(`wrote lib/grocery-pool.json — ${arr.length} terms`);

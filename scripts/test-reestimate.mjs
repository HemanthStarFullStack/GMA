/**
 * Stress-test for household-size re-estimation logic.
 * Tests the scaling formula used in lib/gemini.ts.
 * Run: node scripts/test-reestimate.mjs
 */

// Mirrors lib/gemini.ts: forHousehold(perPerson, category, household)
function forHousehold(perPerson, category, household) {
    // ponytail: personal care = individual use, not shared → no household scaling
    const shared = category !== 'Personal Care';
    return Math.max(1, Math.round(perPerson / (shared ? household : 1)));
}

const cases = [
    // Shared food/beverage — should scale linearly
    { name: 'Milk 1L: 1→2 people',         perPerson: 3,  cat: 'Dairy & Eggs',        h: 2,  expect: 2  },
    { name: 'Milk 1L: 1→4 people',         perPerson: 3,  cat: 'Dairy & Eggs',        h: 4,  expect: 1  },
    { name: 'Rice 5kg: 2→4 people',         perPerson: 34, cat: 'Pantry',              h: 4,  expect: 9  },
    { name: 'Cooking oil 1L: 1→3 people',   perPerson: 30, cat: 'Pantry',              h: 3,  expect: 10 },
    { name: 'Cola 2L: 4→8 people (min 1)',  perPerson: 4,  cat: 'Beverages',           h: 8,  expect: 1  },
    { name: 'Chips 26g: 6 people (min 1)',  perPerson: 1,  cat: 'Snacks',              h: 6,  expect: 1  },
    { name: 'Atta 10kg: 1→4 then →2',       perPerson: 45, cat: 'Pantry',              h: 2,  expect: 23 },
    // Personal Care — must NOT scale with household size
    { name: 'Deodorant 150ml: 1→4 people',  perPerson: 45, cat: 'Personal Care',       h: 4,  expect: 45 },
    { name: 'Toothpaste 200g: 2→4 people',  perPerson: 60, cat: 'Personal Care',       h: 4,  expect: 60 },
    { name: 'Shampoo 340ml: 1→5 people',    perPerson: 60, cat: 'Personal Care',       h: 5,  expect: 60 },
];

let passed = 0;
let failed = 0;
for (const c of cases) {
    const got = forHousehold(c.perPerson, c.cat, c.h);
    const ok = got === c.expect;
    console.log(`${ok ? '✓' : '✗'} ${c.name}: got ${got}, want ${c.expect}`);
    ok ? passed++ : failed++;
}

console.log(`\n${passed}/${cases.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);

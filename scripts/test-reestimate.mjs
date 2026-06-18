/**
 * Stress-test for household-size re-estimation logic.
 * Tests both the rate-based formula (perPersonDailyRate stored at scan)
 * and the legacy linear-scaling fallback.
 * Run: node scripts/test-reestimate.mjs
 */

// Rate-based (precise): mirrors lib/gemini.ts forHousehold + user/route.ts math
function rateBasedDuration(perPersonDailyRate, category, household) {
    if (category === 'Personal Care') return Math.max(1, Math.round(1 / perPersonDailyRate));
    return Math.max(1, Math.round(1 / (perPersonDailyRate * household)));
}

// Legacy fallback: linear scale from stored duration at old household size
function legacyScale(oldDuration, oldN, newN) {
    return Math.max(1, Math.round((oldDuration * oldN) / newN));
}

const cases = [
    // ── Rate-based (perPersonDailyRate stored at scan) ────────────────────────
    // Milk 1L: Gemini → servingsPerUnit=4, dailyUse=1.3 → rate=0.325
    { label: 'Milk 1L 1→2p (rate)',   fn: () => rateBasedDuration(0.325, 'Dairy & Eggs', 2),  expect: 2  },
    { label: 'Milk 1L 1→4p (rate)',   fn: () => rateBasedDuration(0.325, 'Dairy & Eggs', 4),  expect: 1  },
    // Rice 5kg: servingsPerUnit=66, dailyUse=1.5 → rate≈0.0227
    { label: 'Rice 5kg 2→4p (rate)',  fn: () => rateBasedDuration(0.0227, 'Pantry', 4),       expect: 11 },
    // Cola 2L: servingsPerUnit=8, dailyUse=2 → rate=0.25
    { label: 'Cola 2L 4→8p (rate)',   fn: () => rateBasedDuration(0.25, 'Beverages', 8),      expect: 1  },
    // Deodorant: personal care, must NOT scale
    { label: 'Deodorant 1→4p (rate)', fn: () => rateBasedDuration(1/45, 'Personal Care', 4),  expect: 45 },
    // Toothpaste: personal care
    { label: 'Toothpaste 2→4p (rate)',fn: () => rateBasedDuration(1/60, 'Personal Care', 4),  expect: 60 },

    // ── Legacy linear scaling (no rate stored, scale from oldDuration) ────────
    // 30-day product: household doubles → 15 days
    { label: 'Oil 1L 1→2p (legacy)',  fn: () => legacyScale(30, 1, 2),                        expect: 15 },
    // 30-day product: household halves → 60 days
    { label: 'Oil 1L 2→1p (legacy)',  fn: () => legacyScale(15, 2, 1),                        expect: 30 },
    // Round-trip: 45d at 1p → 2p(=23) → 1p. Integer rounding means 23×2=46, not 45.
    // This is expected — rate-based avoids this; legacy scaling has ±1 drift.
    { label: 'Atta round-trip (legacy)', fn: () => legacyScale(legacyScale(45, 1, 2), 2, 1),  expect: 46 },
    // Minimum floor: very large household
    { label: 'Cola 2L 1→20p (legacy)',fn: () => legacyScale(4, 1, 20),                        expect: 1  },
];

let passed = 0, failed = 0;
for (const c of cases) {
    const got = c.fn();
    const ok = got === c.expect;
    console.log(`${ok ? '✓' : '✗'} ${c.label}: got ${got}, want ${c.expect}`);
    ok ? passed++ : failed++;
}

console.log(`\n${passed}/${cases.length} passed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);

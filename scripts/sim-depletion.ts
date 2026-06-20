// Tests the SHIPPED helper (lib/depletion.ts) across every scenario we mapped.
// Run: npx tsx scripts/sim-depletion.ts

import { depletion, personDays, type SizeSegment } from "../lib/depletion";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T00:00:00Z").getTime();
const day = (n: number) => new Date(t0 + n * DAY);

const R = 1 / 14; // 1 person eats 1/14 unit/day → 1 unit lasts 1 person 14 days
const base = { perPersonDailyRate: R, averageDuration: 14, isPerPerson: false };

let fails = 0;
const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
function check(name: string, cond: boolean, detail: string) {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}  ${detail}`);
    if (!cond) fails++;
}

// ---------------------------------------------------------------------------
// 1. No size change → must equal old formula: qty*avgAtSize - daysSince
// ---------------------------------------------------------------------------
{
    const size = 2;
    const log: SizeSegment[] = [{ size, from: day(0) }];
    const r = depletion({ ...base, purchaseDate: day(0), qty: 2, now: day(10), currentSize: size, sizeLog: log });
    const avgAtSize = 1 / (R * size); // =7
    const legacy = 2 * avgAtSize - 10; // qty*avg - daysSince = 4
    check("1 no-change matches legacy", approx(r.daysLeft, legacy), `daysLeft=${r.daysLeft.toFixed(3)} legacy=${legacy}`);
}

// ---------------------------------------------------------------------------
// 2. Guest 1 day (size 2→5→2). Estimate must drop AND stay dropped after leave.
// ---------------------------------------------------------------------------
{
    const noGuest: SizeSegment[] = [{ size: 2, from: day(0) }];
    const guest: SizeSegment[] = [{ size: 2, from: day(0) }, { size: 5, from: day(5) }, { size: 2, from: day(6) }];
    const a = depletion({ ...base, purchaseDate: day(0), qty: 2, now: day(10), currentSize: 2, sizeLog: noGuest });
    const b = depletion({ ...base, purchaseDate: day(0), qty: 2, now: day(10), currentSize: 2, sizeLog: guest });
    check("2 guest eats extra (persists after leave)", b.daysLeft < a.daysLeft,
        `noGuest=${a.daysLeft.toFixed(2)}d  guest=${b.daysLeft.toFixed(2)}d  extra eaten=${(b.consumed - a.consumed).toFixed(3)}u`);
}

// ---------------------------------------------------------------------------
// 3. Permanent move-in (size 2→4 forever). Past NOT rewritten at new size.
// ---------------------------------------------------------------------------
{
    const log: SizeSegment[] = [{ size: 2, from: day(0) }, { size: 4, from: day(5) }];
    const timeWeighted = depletion({ ...base, purchaseDate: day(0), qty: 3, now: day(10), currentSize: 4, sizeLog: log });
    // WRONG way: apply size 4 to the whole 10 days
    const naive = depletion({ ...base, purchaseDate: day(0), qty: 3, now: day(10), currentSize: 4, sizeLog: [{ size: 4, from: day(0) }] });
    check("3 permanent move doesn't rewrite past", timeWeighted.remaining > naive.remaining,
        `timeWeighted left=${timeWeighted.remaining.toFixed(3)}u  naive-retro left=${naive.remaining.toFixed(3)}u`);
}

// ---------------------------------------------------------------------------
// 4. 10 toggles, 1 day apart, end back at start size → stateless, no drift.
//    Build a real log; compare to a hand-rolled integral over the same segments.
// ---------------------------------------------------------------------------
{
    const sizes = [2, 5, 2, 5, 2, 5, 2, 5, 2, 5, 2]; // 11 points, 10 changes, ends at 2
    const log: SizeSegment[] = sizes.map((size, i) => ({ size, from: day(i) }));
    const now = day(10);
    const r = depletion({ ...base, purchaseDate: day(0), qty: 5, now, currentSize: 2, sizeLog: log });
    // hand integral: each [i,i+1) day at sizes[i]
    let pd = 0;
    for (let i = 0; i < 10; i++) pd += sizes[i] * 1;
    const handConsumed = R * pd;
    check("4 ten toggles match hand integral (no drift)", approx(r.consumed, handConsumed, 1e-9),
        `helper consumed=${r.consumed.toFixed(6)}u  hand=${handConsumed.toFixed(6)}u`);
}

// ---------------------------------------------------------------------------
// 5. Personal Care: per-person, guest must NOT change it.
// ---------------------------------------------------------------------------
{
    const guest: SizeSegment[] = [{ size: 2, from: day(0) }, { size: 5, from: day(5) }, { size: 2, from: day(6) }];
    const flat: SizeSegment[] = [{ size: 2, from: day(0) }];
    const pcBase = { perPersonDailyRate: R, averageDuration: 14, isPerPerson: true };
    const g = depletion({ ...pcBase, purchaseDate: day(0), qty: 2, now: day(10), currentSize: 2, sizeLog: guest });
    const f = depletion({ ...pcBase, purchaseDate: day(0), qty: 2, now: day(10), currentSize: 2, sizeLog: flat });
    check("5 personal-care ignores guest", approx(g.daysLeft, f.daysLeft), `guest=${g.daysLeft.toFixed(3)} flat=${f.daysLeft.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 6. Run-out: consumed beyond qty clamps to 0, never negative.
// ---------------------------------------------------------------------------
{
    const r = depletion({ ...base, purchaseDate: day(0), qty: 1, now: day(30), currentSize: 2, sizeLog: [{ size: 2, from: day(0) }] });
    check("6 run-out clamps", r.remaining === 0 && r.daysLeft === 0, `remaining=${r.remaining} daysLeft=${r.daysLeft}`);
}

// ---------------------------------------------------------------------------
// 7. Item bought DURING guest stay → only counts elevated days after purchase.
// ---------------------------------------------------------------------------
{
    const log: SizeSegment[] = [{ size: 2, from: day(0) }, { size: 5, from: day(4) }, { size: 2, from: day(8) }];
    // bought day 5 (mid-guest). Should integrate from day 5, not day 0.
    const pd = personDays(day(5), day(10), log, 2); // [5,8)@5=15 + [8,10)@2=4 = 19
    check("7 mid-life purchase integrates from its own date", approx(pd, 19), `personDays=${pd}`);
}

// ---------------------------------------------------------------------------
// 8. Legacy item (no rate) → derive r from averageDuration, still sane.
// ---------------------------------------------------------------------------
{
    const r = depletion({ purchaseDate: day(0), qty: 2, now: day(7), perPersonDailyRate: null, averageDuration: 7, currentSize: 2, isPerPerson: false, sizeLog: [{ size: 2, from: day(0) }] });
    // avg=7 at size2 → r=1/(7*2)=1/14. consumed=r*2*7=1. remaining=1. daysLeft=1*7=7.
    check("8 legacy derives rate", approx(r.remaining, 1) && approx(r.daysLeft, 7), `remaining=${r.remaining.toFixed(3)} daysLeft=${r.daysLeft.toFixed(3)}`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
if (fails) process.exit(1);

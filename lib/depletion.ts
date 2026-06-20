/**
 * Time-weighted stock depletion.
 *
 * The problem: a household's size varies over an item's life (a guest stays a
 * few days, someone moves in/out). Predicting run-out by applying *today's* size
 * to the *whole* past is wrong — it forgets the guest once they leave, and it
 * retroactively rewrites history on a permanent move.
 *
 * The fix: integrate consumption over the actual size-over-time, then project
 * the remainder forward at the current size. With no size changes this reduces
 * exactly to the old `qty * averageDuration - daysSincePurchase`, so nothing
 * regresses; it only diverges (correctly) when size actually varied.
 */

export interface SizeSegment {
    size: number;
    from: Date | string; // when this household size took effect
}

const DAY = 86_400_000;

/**
 * Σ household-size over [start, end], in person-days.
 * A log entry's size applies from its `from` until the next entry. For time
 * before the earliest entry we extrapolate the earliest known size backward.
 * ponytail: backward-extrapolation is a best guess for items older than the log;
 * the run-out survey self-corrects the rate over time. Seed the log on the first
 * size change (see user route) so this only bites pre-existing data, never new.
 */
export function personDays(start: Date, end: Date, log: SizeSegment[], fallbackSize: number): number {
    const s = start.getTime();
    const e = end.getTime();
    if (!(e > s)) return 0;
    if (!log || log.length === 0) return (fallbackSize * (e - s)) / DAY;

    const entries = log
        .map((l) => ({ size: Math.max(1, l.size), from: new Date(l.from).getTime() }))
        .sort((a, b) => a.from - b.from);

    let total = 0;
    for (let i = 0; i < entries.length; i++) {
        // First segment extends backward to cover the window's start.
        const segStart = i === 0 ? Math.min(entries[0].from, s) : entries[i].from;
        const segEnd = i + 1 < entries.length ? entries[i + 1].from : e;
        const lo = Math.max(s, segStart);
        const hi = Math.min(e, segEnd);
        if (hi > lo) total += entries[i].size * (hi - lo);
    }
    return total / DAY;
}

export interface DepletionInput {
    purchaseDate: Date | string;
    qty: number;
    now?: Date;
    perPersonDailyRate?: number | null; // units/person/day, set at scan time
    averageDuration: number; // days one unit lasts at the CURRENT size (kept in sync on size change)
    currentSize: number;
    isPerPerson: boolean; // Personal Care: per-person, never scaled by household
    sizeLog: SizeSegment[];
}

export interface DepletionResult {
    consumed: number; // units eaten since purchase (fractional)
    remaining: number; // units left (clamped ≥ 0)
    daysLeft: number; // days until empty at the current size
}

export function depletion(opts: DepletionInput): DepletionResult {
    const now = opts.now ?? new Date();
    const size = Math.max(1, opts.currentSize);
    const avg = Math.max(1, opts.averageDuration || 14);
    // r = units per person per day. averageDuration is kept = 1/(r*size), so when
    // no rate was stored we recover r from it. Per-person items don't scale by size.
    const sizeFactorNow = opts.isPerPerson ? 1 : size;
    const r =
        opts.perPersonDailyRate && opts.perPersonDailyRate > 0
            ? opts.perPersonDailyRate
            : 1 / (avg * sizeFactorNow);

    const purchase = new Date(opts.purchaseDate);
    const pd = opts.isPerPerson
        ? Math.max(0, (now.getTime() - purchase.getTime()) / DAY) // size factor fixed at 1
        : personDays(purchase, now, opts.sizeLog, size);

    const consumed = Math.max(0, r * pd);
    const remaining = Math.max(0, opts.qty - consumed);
    const forwardRate = r * sizeFactorNow; // units/day at current size
    const daysLeft = forwardRate > 0 ? remaining / forwardRate : 0;
    return { consumed, remaining, daysLeft };
}

import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product } from '@/lib/models';
import { predictProductMeta } from '@/lib/gemini';
import { requireAdmin } from '@/lib/adminGuard';

// Re-estimate products that never got a real prediction — i.e. no
// perPersonDailyRate stored (covers the old 14-day placeholder AND bad early
// guesses like water bottles at 1 day, from when the predictor was 429ing).
// Stores BOTH averageDuration and perPersonDailyRate so the run-out forecast has
// the per-person rate it needs. Idempotent: once a product has a rate it's
// skipped, so user-corrected items aren't clobbered. A failed prediction
// (predictor down) is left untouched and retried next run.
export async function POST(request: Request) {
    const denied = requireAdmin(request);
    if (denied) return denied;

    await connectDB();

    const stale = await Product.find({
        $or: [{ perPersonDailyRate: { $exists: false } }, { perPersonDailyRate: null }],
    }).lean();
    if (stale.length === 0) {
        return NextResponse.json({ updated: 0, message: 'All products already have a per-person rate.' });
    }

    const results: { name: string; days: number; rate?: number }[] = [];
    let skipped = 0;

    for (const p of stale) {
        const meta = await predictProductMeta(p.name, p.brand || '', p.category, p.defaultUnit || 'units');
        // Predictor still down → heuristic fallback. Leave the product as-is so a
        // bad 14-day value doesn't get re-stamped; it'll retry on the next run.
        if (!meta.predicted) { skipped++; continue; }

        const set: Record<string, unknown> = { averageDuration: meta.averageDuration };
        if (meta.perPersonDailyRate) set.perPersonDailyRate = meta.perPersonDailyRate;
        // Heal a stale "Other" category if the predictor now has a real one.
        if (meta.category && p.category === 'Other') set.category = meta.category;

        await Product.updateOne({ barcode: p.barcode }, { $set: set });
        results.push({ name: p.name, days: meta.averageDuration, rate: meta.perPersonDailyRate });
    }

    return NextResponse.json({ updated: results.length, skipped, results });
}

import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product } from '@/lib/models';
import { predictProductMeta } from '@/lib/gemini';
import { requireAdmin } from '@/lib/adminGuard';

// One-shot backfill: populates perPersonDailyRate on products that predate the
// field. Also refreshes averageDuration to the 1-person baseline so household
// re-estimation math starts from a clean state.
// Safe to call multiple times — skips products that already have a rate.
export async function POST(request: Request) {
    const denied = requireAdmin(request);
    if (denied) return denied;

    await connectDB();

    const targets = await Product.find({
        isDemo: { $ne: true },
        perPersonDailyRate: { $exists: false },
    }).lean();

    if (targets.length === 0) {
        return NextResponse.json({ updated: 0, message: 'All products already have perPersonDailyRate.' });
    }

    const results: { name: string; rate: number; duration: number }[] = [];
    const errors: { name: string; error: string }[] = [];

    for (const p of targets) {
        try {
            const meta = await predictProductMeta(
                p.name,
                p.brand || '',
                p.category,
                p.defaultUnit || 'units',
                {
                    flavor: p.flavor || undefined,
                    price: p.price || undefined,
                    householdSize: 1, // always get per-person baseline
                },
            );
            if (meta.predicted && meta.perPersonDailyRate) {
                await Product.updateOne(
                    { barcode: p.barcode },
                    { $set: { perPersonDailyRate: meta.perPersonDailyRate, averageDuration: meta.averageDuration, aiPredicted: true } },
                );
                results.push({ name: p.name, rate: meta.perPersonDailyRate, duration: meta.averageDuration });
            }
        } catch (err: any) {
            errors.push({ name: p.name, error: err.message });
        }
    }

    return NextResponse.json({ updated: results.length, skipped: targets.length - results.length - errors.length, errors, results });
}

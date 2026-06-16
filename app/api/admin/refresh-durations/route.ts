import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product } from '@/lib/models';
import { predictConsumptionDays } from '@/lib/gemini';
import { requireAdmin } from '@/lib/adminGuard';

// One-shot endpoint: updates averageDuration for every product still at the
// default 14-day placeholder. Safe to call multiple times — skips products
// that already have a real prediction.
export async function POST(request: Request) {
    const denied = requireAdmin(request);
    if (denied) return denied;

    await connectDB();

    const stale = await Product.find({ averageDuration: 14 }).lean();
    if (stale.length === 0) {
        return NextResponse.json({ updated: 0, message: 'All products already have real predictions.' });
    }

    const results: { name: string; days: number }[] = [];

    for (const p of stale) {
        const days = await predictConsumptionDays(
            p.name,
            p.brand || '',
            p.category,
            p.defaultUnit || 'units',
        );
        await Product.updateOne({ barcode: p.barcode }, { $set: { averageDuration: days } });
        results.push({ name: p.name, days });
    }

    return NextResponse.json({ updated: results.length, results });
}

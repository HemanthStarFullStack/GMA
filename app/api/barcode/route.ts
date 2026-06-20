import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product } from '@/lib/models';
import { predictProductMeta } from '@/lib/gemini';

/**
 * Barcode Lookup Service (no AI for the lookup itself).
 *
 * Resolution order — the flow NEVER dead-ends:
 *   1. Local cache (Product collection) — instant, free, and self-learning.
 *      Any product ever added by any user resolves here on the next scan.
 *   2. Nothing found -> 404 NOT_FOUND, and the client opens the scan/manual
 *      form, which writes the product to the cache keyed by this barcode so it
 *      resolves instantly for everyone next time.
 *
 * We deliberately do NOT query open barcode databases (OpenFoodFacts /
 * OpenBeautyFacts): their Indian-FMCG coverage is poor, so they mostly 404 and
 * just add latency. Instead the cache, seeded by real scans, becomes our own
 * India-focused barcode catalogue.
 */

// UPC-A (12-digit) and EAN-13 (13-digit) encode the same product — UPC-A is
// just EAN-13 with the leading zero dropped. Scanners (including ZXing) can
// return either form for the same barcode depending on which format they
// detect first. Normalizing to EAN-13 before any DB operation guarantees a
// stable cache key regardless of which form the scanner produces.
function normalizeBarcode(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.length === 12 ? '0' + digits : digits;
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const barcode = normalizeBarcode(searchParams.get('barcode')?.trim() ?? '');

        if (!barcode) {
            return NextResponse.json({ success: false, message: 'Barcode is required' }, { status: 400 });
        }

        await connectDB();

        // CACHE — shared, self-learning catalogue keyed by barcode (our India DB).
        // Any product any account has already resolved lives here, so a repeat
        // scan (by anyone) costs zero AI calls.
        const cached = await Product.findOne({ barcode });
        if (cached) {
            // If a prior scan only got a heuristic fallback (e.g. it was cached
            // during a Gemini outage / rate-limit), heal it now with a real
            // prediction so every future scan — for every account — is correct.
            let averageDuration = cached.averageDuration ?? 14;
            let category = cached.category || 'Other';
            if (!cached.aiPredicted) {
                const meta = await predictProductMeta(cached.name, cached.brand || '', category, cached.defaultUnit || 'units', {
                    flavor: cached.flavor || undefined,
                    price: cached.price || undefined,
                });
                if (meta.predicted) {
                    averageDuration = meta.averageDuration;
                    category = meta.category;
                    const healSet: Record<string, unknown> = { averageDuration, category, aiPredicted: true };
                    if (meta.perPersonDailyRate) healSet.perPersonDailyRate = meta.perPersonDailyRate;
                    Product.updateOne({ barcode }, { $set: healSet })
                        .catch((err: unknown) => console.warn('Cache heal failed:', err));
                }
            }
            return NextResponse.json({
                success: true,
                source: 'cache',
                data: {
                    barcode: cached.barcode,
                    name: cached.name,
                    brand: cached.brand || '',
                    flavor: cached.flavor || '',
                    price: cached.price || '',
                    category,
                    imageUrl: cached.imageUrl || null,
                    unit: cached.defaultUnit || 'units',
                    averageDuration,
                },
            });
        }

        // Not in our catalogue yet — the client falls back to scan/manual, which
        // writes it to the cache keyed by this barcode for instant future hits.
        return NextResponse.json(
            {
                success: false,
                message: 'Product not found in catalogue',
                code: 'NOT_FOUND',
                barcode,
            },
            { status: 404 },
        );
    } catch (error: any) {
        console.error('Barcode lookup error:', error);
        return NextResponse.json(
            { success: false, message: 'Internal server error during lookup', error: error.message },
            { status: 500 },
        );
    }
}

import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product } from '@/lib/models';
import { predictProductMeta } from '@/lib/gemini';

/**
 * Barcode Lookup Service (no AI).
 *
 * Resolution order — the flow NEVER dead-ends:
 *   1. Local cache (Product collection) — instant, free, and self-learning.
 *      Any product ever added by any user resolves here on the next scan.
 *   2. UPCitemDB (trial) — broad US/international coverage.
 *   3. OpenFoodFacts — strong grocery/global coverage, returns images.
 *   4. Nothing found -> 404 NOT_FOUND, and the client opens a manual-add form
 *      (which then writes to the cache so it resolves instantly next time).
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

const CATEGORIES = [
    'Dairy & Eggs', 'Beverages', 'Fruits & Vegetables', 'Meat & Seafood',
    'Bakery', 'Pantry', 'Frozen Foods', 'Snacks', 'Condiments & Sauces',
    'Cleaning & Household', 'Personal Care', 'Other',
];

function normalizeCategory(raw?: string | null): string {
    if (!raw) return 'Other';
    const lower = raw.toLowerCase();
    const match = CATEGORIES.find((c) => lower.includes(c.toLowerCase().split(' ')[0]));
    return match || 'Other';
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const barcode = normalizeBarcode(searchParams.get('barcode')?.trim() ?? '');

        if (!barcode) {
            return NextResponse.json({ success: false, message: 'Barcode is required' }, { status: 400 });
        }

        await connectDB();

        // 1. CACHE FIRST — shared, self-learning catalogue (the "RAG" store).
        //    Any product any account has already resolved lives here, so a
        //    repeat scan (by anyone) costs zero AI calls.
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

        let productData: any = null;
        let source = 'none';
        let upcRateLimited = false;

        // 2. UPCitemDB
        try {
            const upcRes = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`, {
                headers: { 'User-Agent': 'SINTI-App/2.0' },
            });
            if (upcRes.status === 429) {
                upcRateLimited = true;
                console.warn('UPCitemDB rate limit hit (trial ~100 req/day)');
            } else if (upcRes.ok) {
                const upcData = await upcRes.json();
                if (upcData.items && upcData.items.length > 0) {
                    const item = upcData.items[0];
                    productData = {
                        barcode: item.ean || item.upc || barcode,
                        name: item.title || 'Unknown Product',
                        brand: item.brand || '',
                        flavor: '',
                        category: normalizeCategory(item.category),
                        imageUrl: item.images?.[0] || null,
                        unit: 'units',
                    };
                    source = 'upcitemdb';
                }
            }
        } catch (err) {
            console.warn('UPCitemDB lookup failed:', err);
        }

        // 3. OpenFoodFacts
        if (!productData) {
            try {
                const offRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`, {
                    headers: { 'User-Agent': 'SINTI-App/2.0 (portfolio project)' },
                });
                if (offRes.ok) {
                    const offData = await offRes.json();
                    if (offData.status === 1 && offData.product) {
                        const p = offData.product;
                        productData = {
                            barcode: p.code || barcode,
                            name: p.product_name || p.product_name_en || 'Unknown Product',
                            brand: (p.brands || '').split(',')[0].trim(),
                            flavor: '',
                            category: normalizeCategory(p.categories?.split(',').pop()),
                            imageUrl: p.image_front_url || p.image_url || null,
                            unit: p.quantity || 'units',
                        };
                        source = 'openfoodfacts';
                    }
                }
            } catch (err) {
                console.warn('OpenFoodFacts lookup failed:', err);
            }
        }

        if (productData) {
            // barcode is already normalized to EAN-13 at entry; pin the returned
            // data to the same key so inventory productId stays consistent.
            productData.barcode = barcode;

            // Gemini decides both the realistic shelf-life and the category;
            // the DB's category guess is only a fallback hint.
            const meta = await predictProductMeta(
                productData.name,
                productData.brand || '',
                productData.category,
                productData.unit || 'units',
                { flavor: productData.flavor || undefined },
            );
            const { averageDuration, category, predicted } = meta;
            productData.category = category;
            productData.price = '';

            Product.findOneAndUpdate(
                { barcode },
                {
                    $setOnInsert: {
                        barcode,
                        name: productData.name,
                        brand: productData.brand || '',
                        flavor: productData.flavor || '',
                        category,
                        imageUrl: productData.imageUrl || null,
                        defaultUnit: productData.unit || 'units',
                        averageDuration,
                        ...(meta.perPersonDailyRate ? { perPersonDailyRate: meta.perPersonDailyRate } : {}),
                        aiPredicted: predicted,
                        addedBy: 'barcode',
                        source,
                        isDemo: false,
                    },
                },
                { upsert: true },
            ).catch((err: unknown) => console.warn('Product cache write failed:', err));

            return NextResponse.json({ success: true, source, data: { ...productData, averageDuration } });
        }

        return NextResponse.json(
            {
                success: false,
                message: 'Product not found in any database',
                code: upcRateLimited ? 'RATE_LIMITED' : 'NOT_FOUND',
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

import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, User } from '@/lib/models';
import { resolveProducts } from '@/lib/userProduct';
import { depletion, type SizeSegment } from '@/lib/depletion';

/**
 * Shared run-out forecasting. Lifted verbatim out of the analytics route so the
 * shopping list and the home "needs restock" badge compute low stock from the
 * exact same numbers the Analytics page shows — one source of truth.
 *
 * Predictions are rhythm-based: from past consumption logs we learn an average
 * duration, derive a consumption rate, and project days-until-empty against
 * current stock (time-weighted by how household size varied over each lot's life).
 */

export interface ProductForecast {
    productId: string;
    name: string;
    brand: string;
    category: string;
    imageUrl: string | null;
    defaultUnit: string;
    unit: string;
    status: 'in_stock' | 'out_of_stock';
    currentStock: number;
    purchaseDate: Date | null;
    rows?: { purchaseDate: Date; qty: number }[];
    // Best per-pack duration estimate (blended history + catalogue, or just the
    // AI catalogue value before any history). Always set so Analytics can show an
    // estimate even when there's no stock to project a run-out date from.
    estimatedDurationDays: number;
    consumptionHistory: {
        timesConsumed: number;
        averageDurationDays: number;
        lastConsumed: string | null;
    };
    predictions: {
        consumptionRate: number;
        daysUntilEmpty: number;
        restockDate: string;
        needsRestock: boolean;
    } | null;
}

// A real pack lasts at least this fraction of its catalogue duration estimate.
// Anything shorter is treated as a mis-tap / spammed consume and ignored when
// learning the rate. Filtering by VALUE (not tap timing) makes the forecast
// robust no matter how fast OR slow the − button is spammed.
const PLAUSIBLE_MIN_FRACTION = 0.2;

/**
 * Is this logged duration plausibly a real pack lifetime (vs spam)? Without a
 * catalogue estimate there's nothing to compare against, so accept it.
 */
function isPlausibleDuration(durationDays: number, catalogueAvg: number): boolean {
    if (!catalogueAvg || catalogueAvg <= 0) return durationDays >= 1;
    return durationDays >= Math.max(1, Math.round(catalogueAvg * PLAUSIBLE_MIN_FRACTION));
}

/** Build per-product stock + consumption + run-out forecasts for a user. */
export async function buildForecasts(userId: string): Promise<ProductForecast[]> {
    await connectDB();

    // userId is a string everywhere on Inventory/ConsumptionLog, but User._id is an
    // ObjectId — findById throws a CastError on a non-ObjectId id (e.g. the dev test
    // user). Guard it so a forecast never crashes the caller (home page, analytics).
    const user = mongoose.Types.ObjectId.isValid(userId)
        ? await User.findById(userId).select('familySize familySizeLog').lean()
        : null;
    const [currentInventory, consumptionLogs] = await Promise.all([
        Inventory.find({ userId }).lean(),
        ConsumptionLog.find({ userId }).lean(),
    ]);
    const currentSize = Math.max(1, user?.familySize ?? 1);
    const sizeLog = (user?.familySizeLog as SizeSegment[] | undefined) ?? [];

    // Resolve each product to THIS user's version (UserProduct → shared fallback),
    // so their forecast uses their own name, category, shelf-life and rate — never
    // another account's. Same overlay the display routes use.
    const barcodes = [
        ...new Set([...currentInventory.map((i) => i.productId), ...consumptionLogs.map((l) => l.productId)]),
    ];
    const productMap = await resolveProducts(userId, barcodes);

    const detailsFor = (barcode: string) => {
        const p = productMap.get(barcode);
        return {
            name: p?.name || `Product ${barcode.slice(0, 8)}`,
            brand: p?.brand || '-',
            category: p?.category || 'Other',
            imageUrl: p?.imageUrl || null,
            defaultUnit: p?.defaultUnit || 'units',
        };
    };

    const map = new Map<string, any>();

    // Aggregate current stock per product (sum quantities).
    for (const item of currentInventory) {
        const id = item.productId;
        if (!map.has(id)) {
            const d = detailsFor(id);
            map.set(id, {
                productId: id,
                ...d,
                unit: item.unit || d.defaultUnit,
                status: 'in_stock',
                currentStock: 0,
                purchaseDate: item.purchaseDate,
                rows: [],
                consumptionHistory: { timesConsumed: 0, averageDurationDays: 0, lastConsumed: null },
                predictions: null,
            });
        }
        const entry = map.get(id);
        entry.currentStock += item.quantity;
        entry.rows.push({ purchaseDate: item.purchaseDate, qty: item.quantity });
    }

    // Fold in consumption history.
    for (const log of consumptionLogs) {
        const id = log.productId;
        // The product must still appear in the forecast even if EVERY one of its
        // logs is a mis-tap — otherwise a fully-consumed item would vanish (its only
        // proof of existence is its logs) and drop off the shopping list. So the
        // plausibility filter gates only the LEARNED RATE below, not existence.
        if (!map.has(id)) {
            const d = detailsFor(id);
            map.set(id, {
                productId: id,
                ...d,
                unit: d.defaultUnit,
                status: 'out_of_stock',
                currentStock: 0,
                purchaseDate: null,
                consumptionHistory: { timesConsumed: 0, averageDurationDays: 0, lastConsumed: null },
                predictions: null,
            });
        }
        const product = map.get(id);
        const logDate = new Date(log.consumedDate);
        if (!product.consumptionHistory.lastConsumed || logDate > new Date(product.consumptionHistory.lastConsumed)) {
            product.consumptionHistory.lastConsumed = log.consumedDate;
        }
        // Implausibly short durations (mis-taps / spammed consumes) don't feed the
        // learned rate — independent of how the taps were timed.
        if (!isPlausibleDuration(log.durationDays || 0, productMap.get(id)?.averageDuration || 0)) continue;
        product.consumptionHistory.timesConsumed += 1;
        product.consumptionHistory.averageDurationDays += log.durationDays || 0;
    }

    const result: ProductForecast[] = Array.from(map.values()).map((product) => {
        const h = product.consumptionHistory;
        const sumDurations = h.averageDurationDays; // accumulated sum, pre-average
        const catalogueAvg = productMap.get(product.productId)?.averageDuration || 0;
        if (h.timesConsumed > 0) {
            h.averageDurationDays = Math.round(sumDurations / h.timesConsumed);
        }

        // Effective duration driving the run-out projection. Blend the AI catalogue
        // estimate (a prior worth ~3 observations) with logged history so a single
        // premature log — e.g. the first ±stepper decrement, durationDays≈1, which
        // measures purchase→first-use rather than the real cadence — can't wipe out
        // a 60-day estimate. Several real logs outweigh the prior and take over.
        let avgDuration: number;
        if (h.timesConsumed > 0 && catalogueAvg > 0) {
            avgDuration = Math.round((catalogueAvg * 3 + sumDurations) / (3 + h.timesConsumed));
        } else if (h.timesConsumed > 0) {
            avgDuration = h.averageDurationDays;
        } else {
            avgDuration = catalogueAvg;
        }
        product.estimatedDurationDays = avgDuration;

        if (product.status === 'in_stock' && avgDuration > 0) {
            const prod = productMap.get(product.productId);
            const isPerPerson = prod?.category === 'Personal Care';
            const sizeFactorNow = isPerPerson ? 1 : currentSize;
            // Rate consistency: once real consumption logs exist, the blended
            // avgDuration IS the learned rate — use it for BOTH the backward
            // depletion of `remaining` AND the forward projection, so the two
            // halves can't disagree. Only before any logs do we lean on the
            // scan-time perPersonDailyRate (which keeps size-over-time weighting).
            // (Previously `remaining` used the stored rate while daysUntilEmpty
            // divided by 1/avgDuration — divergent once history accumulated.)
            const rate = h.timesConsumed > 0 ? null : (prod?.perPersonDailyRate ?? null);
            // Time-weighted: deplete each purchase lot by how the household size
            // actually varied over its life, then project the remainder forward.
            const now = new Date();
            const remaining = (product.rows as { purchaseDate: Date; qty: number }[]).reduce(
                (sum, row) =>
                    sum +
                    depletion({
                        purchaseDate: row.purchaseDate,
                        qty: row.qty,
                        now,
                        perPersonDailyRate: rate,
                        averageDuration: avgDuration,
                        currentSize,
                        isPerPerson,
                        sizeLog,
                    }).remaining,
                0,
            );
            // Forward rate derived the SAME way depletion derived its own — units
            // per day at the current household size.
            const r = rate && rate > 0 ? rate : 1 / (avgDuration * sizeFactorNow);
            const forwardRate = r * sizeFactorNow;
            const daysUntilEmpty = forwardRate > 0 ? remaining / forwardRate : 0;
            product.predictions = {
                consumptionRate: Math.round(forwardRate * 100) / 100,
                daysUntilEmpty: Math.round(daysUntilEmpty * 10) / 10,
                restockDate: new Date(now.getTime() + daysUntilEmpty * 86400000).toISOString(),
                needsRestock: daysUntilEmpty < 7,
            };
        }
        return product;
    });

    return result;
}

/**
 * True when a product needs restocking. One plain, visible rule: you're out (0)
 * or down to your last pack (1). The run-out forecast (predictions) is shown on
 * Analytics but deliberately does NOT drive the shopping list — that coupling made
 * the list unpredictable ("why is this here?") and caused subtle bugs.
 */
export function isLow(p: ProductForecast): boolean {
    return p.currentStock <= 1;
}

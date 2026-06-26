import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, Product, User } from '@/lib/models';
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

    // Join product details once, by barcode (productId === barcode).
    const barcodes = [
        ...new Set([...currentInventory.map((i) => i.productId), ...consumptionLogs.map((l) => l.productId)]),
    ];
    const products = await Product.find({ barcode: { $in: barcodes } }).lean();
    const productMap = new Map(products.map((p) => [p.barcode, p]));

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
        product.consumptionHistory.timesConsumed += 1;
        product.consumptionHistory.averageDurationDays += log.durationDays || 0;
        const logDate = new Date(log.consumedDate);
        if (!product.consumptionHistory.lastConsumed || logDate > new Date(product.consumptionHistory.lastConsumed)) {
            product.consumptionHistory.lastConsumed = log.consumedDate;
        }
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

        if (product.status === 'in_stock' && avgDuration > 0) {
            const prod = productMap.get(product.productId);
            const isPerPerson = prod?.category === 'Personal Care';
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
                        perPersonDailyRate: prod?.perPersonDailyRate ?? null,
                        averageDuration: avgDuration,
                        currentSize,
                        isPerPerson,
                        sizeLog,
                    }).remaining,
                0,
            );
            const consumptionRate = 1 / avgDuration; // units/day at current size
            const daysUntilEmpty = remaining / consumptionRate;
            product.predictions = {
                consumptionRate: Math.round(consumptionRate * 100) / 100,
                daysUntilEmpty: Math.round(daysUntilEmpty * 10) / 10,
                restockDate: new Date(now.getTime() + daysUntilEmpty * 86400000).toISOString(),
                needsRestock: daysUntilEmpty < 7,
            };
        }
        return product;
    });

    return result;
}

/** True when a product is out of stock or forecast to run out within 7 days. */
export function isLow(p: ProductForecast): boolean {
    return p.status === 'out_of_stock' || !!p.predictions?.needsRestock;
}

/** The subset of a user's products that need restocking. */
export async function lowStockItems(userId: string): Promise<ProductForecast[]> {
    const all = await buildForecasts(userId);
    return all.filter(isLow);
}

/** How many products need restocking — for the home badge/banner. */
export async function lowStockCount(userId: string): Promise<number> {
    return (await lowStockItems(userId)).length;
}

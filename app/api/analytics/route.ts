import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, Product, User } from '@/lib/models';
import { depletion, type SizeSegment } from '@/lib/depletion';
import { auth } from '@/auth';

/**
 * Consumption analytics + run-out predictions.
 *
 * Predictions are rhythm-based: from a product's past consumption logs we learn an
 * average duration, derive a consumption rate, and project days-until-empty against
 * current stock. This tolerates gaps in purchase data — it models the flow, not events.
 */

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const userId = session.user.id;

        const [currentInventory, consumptionLogs, user] = await Promise.all([
            Inventory.find({ userId }).lean(),
            ConsumptionLog.find({ userId }).lean(),
            User.findById(userId).select('familySize familySizeLog').lean(),
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
                    consumptionHistory: { totalConsumed: 0, timesConsumed: 0, averageDurationDays: 0, lastConsumed: null },
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
                    consumptionHistory: { totalConsumed: 0, timesConsumed: 0, averageDurationDays: 0, lastConsumed: null },
                    predictions: null,
                });
            }
            const product = map.get(id);
            product.consumptionHistory.totalConsumed += 1;
            product.consumptionHistory.timesConsumed += 1;
            product.consumptionHistory.averageDurationDays += log.durationDays || 0;
            const logDate = new Date(log.consumedDate);
            if (!product.consumptionHistory.lastConsumed || logDate > new Date(product.consumptionHistory.lastConsumed)) {
                product.consumptionHistory.lastConsumed = log.consumedDate;
            }
        }

        const result = Array.from(map.values()).map((product) => {
            const h = product.consumptionHistory;
            if (h.timesConsumed > 0) {
                h.averageDurationDays = Math.round(h.averageDurationDays / h.timesConsumed);
            }

            // Fall back to the catalogue's averageDuration if there's stock but no logs yet.
            let avgDuration = h.averageDurationDays;
            if (product.status === 'in_stock' && avgDuration <= 0) {
                avgDuration = productMap.get(product.productId)?.averageDuration || 0;
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

        result.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'in_stock' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return NextResponse.json({
            success: true,
            data: {
                products: result,
                stats: {
                    totalProducts: result.length,
                    inStock: result.filter((p) => p.status === 'in_stock').length,
                    outOfStock: result.filter((p) => p.status === 'out_of_stock').length,
                    needRestock: result.filter((p) => p.predictions?.needsRestock).length,
                },
            },
        });
    } catch (error: any) {
        console.error('Analytics error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

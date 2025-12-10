import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';

export async function GET() {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();

        // Get ALL inventory items (current)
        const currentInventory = await Inventory.find({ userId: session.user.id }).lean();

        // Get ALL consumption logs
        const consumptionLogs = await ConsumptionLog.find({ userId: session.user.id }).lean();

        // Build a map of all unique products
        const productsMap = new Map();

        // Add products from current inventory
        for (const item of currentInventory) {
            const productId = item.productId;
            if (!productsMap.has(productId)) {
                productsMap.set(productId, {
                    productId,
                    name: item.productDetails?.name || 'Unknown Product',
                    brand: item.productDetails?.brand || '-',
                    category: item.productDetails?.category || 'Other',
                    imageUrl: item.productDetails?.imageUrl,
                    status: 'in_stock',
                    currentStock: item.quantity,
                    unit: item.unit,
                    purchaseDate: item.purchaseDate,
                    consumptionHistory: {
                        totalConsumed: 0,
                        timesConsumed: 0,
                        averageDurationDays: 0,
                        lastConsumed: null
                    },
                    predictions: null
                });
            }
        }

        // Add products from consumption logs
        for (const log of consumptionLogs) {
            const productId = log.productId;

            if (!productsMap.has(productId)) {
                // Product consumed but not in current inventory
                // Try to find product details from inventory first
                let productDetails = currentInventory.find(inv => inv.productId === productId)?.productDetails;

                // If not in inventory, query Product collection
                if (!productDetails) {
                    const productDoc = await Product.findOne({ barcode: productId });
                    if (productDoc) {
                        productDetails = {
                            name: productDoc.name,
                            brand: productDoc.brand,
                            category: productDoc.category,
                            imageUrl: productDoc.imageUrl
                        };
                    }
                }

                productsMap.set(productId, {
                    productId,
                    name: productDetails?.name || `Product ${productId.slice(0, 8)}`,
                    brand: productDetails?.brand || '-',
                    category: productDetails?.category || 'Other',
                    imageUrl: productDetails?.imageUrl,
                    status: 'out_of_stock',
                    currentStock: 0,
                    unit: 'units',
                    purchaseDate: null,
                    consumptionHistory: {
                        totalConsumed: 0,
                        timesConsumed: 0,
                        averageDurationDays: 0,
                        lastConsumed: null
                    },
                    predictions: null
                });
            }

            // Update consumption history
            const product = productsMap.get(productId);
            product.consumptionHistory.totalConsumed += 1; // Each log = 1 unit consumed
            product.consumptionHistory.timesConsumed += 1;
            product.consumptionHistory.averageDurationDays += log.durationDays || 0;

            const logDate = new Date(log.consumedDate);
            if (!product.consumptionHistory.lastConsumed || logDate > new Date(product.consumptionHistory.lastConsumed)) {
                product.consumptionHistory.lastConsumed = log.consumedDate;
            }
        }

        // Calculate averages and predictions for each product
        const products = Array.from(productsMap.values()).map(product => {
            // Calculate average duration
            if (product.consumptionHistory.timesConsumed > 0) {
                product.consumptionHistory.averageDurationDays =
                    Math.round(product.consumptionHistory.averageDurationDays / product.consumptionHistory.timesConsumed);
            }

            // Calculate predictions if product is in stock
            if (product.status === 'in_stock' && product.consumptionHistory.averageDurationDays > 0) {
                const consumptionRate = 1 / product.consumptionHistory.averageDurationDays; // units per day
                const daysUntilEmpty = product.currentStock / consumptionRate;
                const restockDate = new Date(Date.now() + daysUntilEmpty * 24 * 60 * 60 * 1000);

                product.predictions = {
                    consumptionRate: Math.round(consumptionRate * 100) / 100,
                    daysUntilEmpty: Math.round(daysUntilEmpty * 10) / 10,
                    restockDate: restockDate.toISOString(),
                    needsRestock: daysUntilEmpty < 7
                };
            }

            return product;
        });

        // Sort: in stock first, then by name
        products.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'in_stock' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return NextResponse.json({
            success: true,
            data: {
                products,
                stats: {
                    totalProducts: products.length,
                    inStock: products.filter(p => p.status === 'in_stock').length,
                    outOfStock: products.filter(p => p.status === 'out_of_stock').length,
                    needRestock: products.filter(p => p.predictions?.needsRestock).length
                }
            }
        });
    } catch (error: any) {
        console.error('Analytics error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}

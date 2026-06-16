import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product, Inventory, ConsumptionLog } from '@/lib/models';

/**
 * One-shot data reset for a fresh start.
 *
 *   POST /api/admin/reset?confirm=RESET
 *
 * Wipes the data collections (inventory, consumption history, and the shared
 * product catalogue/cache) so that re-scanning regenerates products with the
 * new Gemini-decided categories. User/auth records are intentionally left
 * untouched, so you stay logged in.
 *
 * Not exposed in the UI; guarded by the ?confirm=RESET query token so it can't
 * fire by accident. Safe to call repeatedly.
 */
export async function POST(request: Request) {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('confirm') !== 'RESET') {
        return NextResponse.json(
            { success: false, message: 'Add ?confirm=RESET to confirm the wipe.' },
            { status: 400 },
        );
    }

    try {
        await connectDB();
        const [inv, logs, prods] = await Promise.all([
            Inventory.deleteMany({}),
            ConsumptionLog.deleteMany({}),
            Product.deleteMany({}),
        ]);

        return NextResponse.json({
            success: true,
            message: 'Fresh start: data collections cleared (users kept).',
            deleted: {
                inventory: inv.deletedCount ?? 0,
                consumptionLogs: logs.deletedCount ?? 0,
                products: prods.deletedCount ?? 0,
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Reset failed', error: error.message },
            { status: 500 },
        );
    }
}

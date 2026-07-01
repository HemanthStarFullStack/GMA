import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product, Inventory, ConsumptionLog, ShoppingList } from '@/lib/models';
import { requireAdmin } from '@/lib/adminGuard';
import { serverError } from '@/lib/apiError';

/**
 * One-shot data reset for a fresh start on ONE account.
 *
 *   POST /api/admin/reset?confirm=RESET&userId=<id>
 *
 * Wipes that user's inventory, consumption history, and shopping list, plus
 * the shared product catalogue/cache (global by design — every account's next
 * scan regenerates it with the current Gemini-decided categories, so wiping
 * it isn't account-scoped data loss). User/auth records are untouched.
 *
 * userId is required so this can never accidentally wipe every account's
 * personal data in one call — it used to run unscoped deleteMany({}) on
 * Inventory/ConsumptionLog/ShoppingList, which cleared them for ALL users.
 *
 * Not exposed in the UI; guarded by the ?confirm=RESET query token so it can't
 * fire by accident. Safe to call repeatedly.
 */
export async function POST(request: Request) {
    const denied = requireAdmin(request);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    if (searchParams.get('confirm') !== 'RESET') {
        return NextResponse.json(
            { success: false, message: 'Add ?confirm=RESET to confirm the wipe.' },
            { status: 400 },
        );
    }
    const userId = (searchParams.get('userId') || '').trim();
    if (!userId) {
        return NextResponse.json(
            { success: false, message: 'Add ?userId=<id> to scope the wipe to one account.' },
            { status: 400 },
        );
    }

    try {
        await connectDB();
        const [inv, logs, shop, prods] = await Promise.all([
            Inventory.deleteMany({ userId }),
            ConsumptionLog.deleteMany({ userId }),
            ShoppingList.deleteMany({ userId }),
            Product.deleteMany({}),
        ]);

        return NextResponse.json({
            success: true,
            message: `Fresh start for ${userId}: personal data cleared, shared catalogue reset.`,
            deleted: {
                inventory: inv.deletedCount ?? 0,
                consumptionLogs: logs.deletedCount ?? 0,
                shoppingList: shop.deletedCount ?? 0,
                products: prods.deletedCount ?? 0,
            },
        });
    } catch (error: any) {
        return serverError('admin.reset', error, 'Reset failed');
    }
}

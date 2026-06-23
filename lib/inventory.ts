import { Inventory, Product } from '@/lib/models';

/**
 * Add a product to a user's pantry: increment the existing active row for this
 * barcode, or create a new one. Centralises the "increment-or-create" rule so
 * re-add (history), the shopping-list "got it" action, and the inventory POST
 * all behave identically — and all resolve the pack size the same way.
 *
 * Unit resolution: explicit override → the product's stored defaultUnit → 'units'.
 * This is the fix for re-adds that pass no productDetails (they used to fall back
 * to a bare 'units' instead of the real pack size).
 *
 * Assumes connectDB() has already been called by the caller.
 */
export async function addToInventory(
    userId: string,
    barcode: string,
    qty = 1,
    unitOverride?: string,
) {
    // ponytail: read-modify-write, not atomic $inc, because topping up must also
    // age the purchaseDate. A bare $inc left the date stale, so fresh units read
    // as old and the forecast warned to restock too early. Blend the lot's date
    // toward now, weighted by how many units are new vs. already there.
    // Ceiling: not race-safe against two concurrent adds of the same barcode
    // (rare: one user tapping). Switch to a transaction if that ever matters.
    const existing = await Inventory.findOne({ userId, productId: barcode, status: 'active' });
    if (existing) {
        const oldQty = existing.quantity;
        const oldT = new Date(existing.purchaseDate).getTime();
        const now = Date.now();
        existing.purchaseDate = new Date(Math.round((oldT * oldQty + now * qty) / (oldQty + qty)));
        existing.quantity = oldQty + qty;
        await existing.save();
        return existing;
    }

    let unit = unitOverride;
    if (!unit) {
        const product = await Product.findOne({ barcode }).select('defaultUnit').lean();
        unit = (product as { defaultUnit?: string } | null)?.defaultUnit || 'units';
    }

    return Inventory.create({
        userId,
        productId: barcode,
        quantity: qty,
        unit,
        purchaseDate: new Date(),
        status: 'active',
        isDemo: false,
    });
}

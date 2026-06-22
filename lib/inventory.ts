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
    const existing = await Inventory.findOneAndUpdate(
        { userId, productId: barcode, status: 'active' },
        { $inc: { quantity: qty } },
        { new: true },
    );
    if (existing) return existing;

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

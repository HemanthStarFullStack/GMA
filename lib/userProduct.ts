import { Product, UserProduct } from '@/lib/models';

/**
 * Per-user product identity.
 *
 * Each account owns its version of a product — name, category, photo, and the
 * shelf-life/rate that drive its forecast. The shared `Product` catalogue is
 * demoted to a suggestion pool (pre-fills the scan form) and is NEVER the
 * display source, so one user's scan can't rewrite what another user sees.
 *
 * Reads overlay: a user's `UserProduct` wins WHOLESALE when present (it's a
 * complete snapshot, written on every confirm), else the shared `Product`, else
 * the caller's own fallback. Assumes connectDB() has already been called.
 */

export interface EffectiveProduct {
    name: string;
    brand: string;
    flavor: string;
    price: string;
    category: string;
    imageUrl: string | null;
    defaultUnit: string;
    averageDuration: number;
    perPersonDailyRate: number | null;
}

// Identity fields a confirm/scan supplies. Only keys present are written, so a
// caller can update just what it knows (mirrors the Product $set pattern).
export interface IdentityFields {
    name?: string;
    brand?: string;
    flavor?: string;
    price?: string;
    category?: string;
    imageUrl?: string | null;
    defaultUnit?: string;
    averageDuration?: number;
    perPersonDailyRate?: number;
}

function effectiveFrom(id: string, src: any): EffectiveProduct {
    return {
        name: src?.name || `Product ${id.slice(0, 8)}`,
        brand: src?.brand ?? '',
        flavor: src?.flavor ?? '',
        price: src?.price ?? '',
        category: src?.category || 'Other',
        imageUrl: src?.imageUrl ?? null,
        defaultUnit: src?.defaultUnit || 'units',
        averageDuration: src?.averageDuration || 14,
        perPersonDailyRate: src?.perPersonDailyRate ?? null,
    };
}

/** Resolve effective identity per productId for one user (UserProduct → Product). */
export async function resolveProducts(
    userId: string,
    productIds: string[],
): Promise<Map<string, EffectiveProduct>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const map = new Map<string, EffectiveProduct>();
    if (ids.length === 0) return map;

    const [shared, mine] = await Promise.all([
        Product.find({ barcode: { $in: ids } }).lean(),
        UserProduct.find({ userId, productId: { $in: ids } }).lean(),
    ]);
    const sharedMap = new Map(shared.map((p: any) => [p.barcode, p]));
    const mineMap = new Map(mine.map((p: any) => [p.productId, p]));

    for (const id of ids) {
        const src = mineMap.get(id) ?? sharedMap.get(id);
        if (src) map.set(id, effectiveFrom(id, src));
    }
    return map;
}

/** Single-product convenience: the user's version, else shared, else null. */
export async function resolveProduct(userId: string, productId: string): Promise<EffectiveProduct | null> {
    const map = await resolveProducts(userId, [productId]);
    return map.get(productId) ?? null;
}

/**
 * Write the user's own version of a product (their display + forecast truth).
 * `name` is required on insert; callers at confirm/manual-add time always have one.
 */
export async function upsertUserProduct(userId: string, productId: string, fields: IdentityFields) {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) set[k] = v;
    }
    await UserProduct.updateOne(
        { userId, productId },
        {
            $set: set,
            $setOnInsert: {
                userId,
                productId,
                ...(set.name === undefined ? { name: `Product ${productId.slice(0, 8)}` } : {}),
            },
        },
        { upsert: true },
    );
}

/**
 * Guarantee the user has a UserProduct for this product, seeding it from the
 * shared catalogue if missing. Called from addToInventory so ANY product that
 * enters a user's stock (scan, "Bought", re-add) becomes theirs and stops
 * tracking the shared record. No-op if one already exists (never clobbers).
 */
export async function ensureUserProduct(userId: string, productId: string) {
    const existing = await UserProduct.findOne({ userId, productId }).select('_id').lean();
    if (existing) return;
    const shared = await Product.findOne({ barcode: productId }).lean() as any;
    const seed = effectiveFrom(productId, shared);
    await UserProduct.updateOne(
        { userId, productId },
        {
            $setOnInsert: {
                userId,
                productId,
                name: seed.name,
                brand: seed.brand,
                flavor: seed.flavor,
                price: seed.price,
                category: seed.category,
                imageUrl: seed.imageUrl,
                defaultUnit: seed.defaultUnit,
                averageDuration: seed.averageDuration,
                ...(seed.perPersonDailyRate != null ? { perPersonDailyRate: seed.perPersonDailyRate } : {}),
            },
        },
        { upsert: true },
    );
}

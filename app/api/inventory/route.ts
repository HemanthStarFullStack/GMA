import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import connectDB from '@/lib/mongodb';
import { Inventory, Product, ConsumptionLog, ShoppingList } from '@/lib/models';
import { addToInventory } from '@/lib/inventory';
import { resolveProducts, resolveProduct, upsertUserProduct } from '@/lib/userProduct';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

const clampRestockQty = (qty: unknown) => Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));

// After a stock change, drop the product's auto shopping-list reminder if it's
// no longer low (total active qty > 1 — mirrors isLow = currentStock <= 1 in
// lib/forecast.ts). The home badge counts pending entries via a fast query that
// skips autoSync, so without this a scanned-back-in item would keep showing on
// the badge until the user next opened /shopping. Manual entries are left alone.
async function clearAutoListIfStocked(userId: string, productId: string) {
    const rows = await Inventory.find({ userId, productId, status: 'active' }).select('quantity').lean();
    const total = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    if (total > 1) {
        await ShoppingList.deleteOne({ userId, productId, source: 'auto' });
    }
}

export async function GET() {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();

        const inventoryItems = await Inventory.find({ userId: session.user.id }).sort({ purchaseDate: -1 }).lean();

        // Show the USER's own version of each product (UserProduct → shared
        // Product fallback), so another account's scan never changes what they see.
        const productMap = await resolveProducts(
            session.user.id,
            inventoryItems.map((i) => i.productId),
        );

        const populatedItems = inventoryItems.map((item) => {
            const product = productMap.get(item.productId);
            return {
                ...item,
                product: product || { name: 'Unknown Product', brand: '', imageUrl: null, category: 'Other', averageDuration: 14 },
            };
        });

        return NextResponse.json({ success: true, data: populatedItems });
    } catch (error: any) {
        return serverError('inventory.GET', error, 'Failed to fetch inventory');
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const body = await request.json();

        const barcode = (body.productId || '').toString().trim();
        if (!barcode) {
            return NextResponse.json({ success: false, message: 'productId (barcode) is required' }, { status: 400 });
        }

        // Cache/update the product in the shared catalogue. Whatever the user
        // confirmed on the scan/manual form is authoritative — they may have
        // corrected the name, size, flavor, price, category, duration or photo —
        // so $set those fields (overwriting any stale or AI-guessed value).
        const d = body.productDetails;
        if (d) {
            const set: Record<string, unknown> = {
                // Confirmed details are trusted; don't let cache-healing overwrite.
                aiPredicted: true,
            };
            if (d.name) set.name = d.name;
            if (d.brand !== undefined) set.brand = d.brand || '';
            if (d.flavor !== undefined) set.flavor = d.flavor || '';
            if (d.price !== undefined) set.price = (d.price ?? '').toString();
            if (d.category) set.category = d.category;
            if (d.imageUrl !== undefined) set.imageUrl = d.imageUrl || null;
            // Size is short ("500 g", "pack of 6"). Cap it so a stray OCR paragraph
            // can never be stored as the unit (Evian once saved a 117-char blurb).
            if (d.unit) set.defaultUnit = String(d.unit).trim().slice(0, 24);
            if (d.averageDuration) set.averageDuration = Number(d.averageDuration) || 14;
            if (d.perPersonDailyRate) set.perPersonDailyRate = Number(d.perPersonDailyRate);

            const setOnInsert: Record<string, unknown> = {
                barcode,
                addedBy: d.addedBy || 'barcode',
                source: d.source || 'barcode',
                isDemo: false,
            };
            // Guarantee required fields exist on first insert if not user-supplied.
            if (!set.name) setOnInsert.name = 'Unknown Product';
            if (!set.category) setOnInsert.category = 'Other';

            await Product.findOneAndUpdate(
                { barcode },
                { $set: set, $setOnInsert: setOnInsert },
                { upsert: true, new: true },
            );
        }

        const qty = body.quantity || 1;
        // Increment an existing active row or create one. Unit falls back to the
        // product's stored defaultUnit (via addToInventory) so re-adds that send
        // no productDetails still get the real pack size, not a bare 'units'.
        const item = await addToInventory(session.user.id, barcode, qty, body.unit || d?.unit);

        // The user's OWN version of this product — what they see + forecast with.
        // Overwrites their copy on a re-scan+edit (addToInventory only seeds one if
        // missing). The shared Product above stays a suggestion pool only.
        if (d) {
            await upsertUserProduct(session.user.id, barcode, {
                ...(d.name ? { name: d.name } : {}),
                ...(d.brand !== undefined ? { brand: d.brand || '' } : {}),
                ...(d.flavor !== undefined ? { flavor: d.flavor || '' } : {}),
                ...(d.price !== undefined ? { price: (d.price ?? '').toString() } : {}),
                ...(d.category ? { category: d.category } : {}),
                ...(d.imageUrl !== undefined ? { imageUrl: d.imageUrl || null } : {}),
                ...(d.unit ? { defaultUnit: String(d.unit).trim().slice(0, 24) } : {}),
                ...(d.averageDuration ? { averageDuration: Number(d.averageDuration) || 14 } : {}),
                ...(d.perPersonDailyRate ? { perPersonDailyRate: Number(d.perPersonDailyRate) } : {}),
            });
        }

        // Scanning/adding stock can resolve a low item — clear its reminder and
        // refresh the home hero/badge (both derive from this stock).
        await clearAutoListIfStocked(session.user.id, barcode);
        revalidatePath('/');
        return NextResponse.json({ success: true, message: 'Item added to inventory', data: item });
    } catch (error: any) {
        return serverError('inventory.POST', error, 'Failed to add item');
    }
}

export async function PATCH(request: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const body = await request.json();
        const id = (body.id || '').toString();
        const delta = Number(body.delta);

        if (!id) {
            return NextResponse.json({ success: false, message: 'Item ID is required' }, { status: 400 });
        }
        if (!Number.isInteger(delta) || delta === 0) {
            return NextResponse.json({ success: false, message: 'delta must be a non-zero integer' }, { status: 400 });
        }
        if (Math.abs(delta) !== 1) {
            return NextResponse.json({ success: false, message: 'delta must be +1 or -1' }, { status: 400 });
        }

        // ponytail: read-modify-write, not atomic $inc — both directions must also
        // move purchaseDate so the forecast learns the real per-unit rate. Ceiling:
        // not race-safe for two concurrent adjusts of one row (rare, single user).
        const row = await Inventory.findOne({ _id: id, userId: session.user.id, status: 'active' });
        if (!row) {
            return NextResponse.json({ success: false, message: 'Item not found or unauthorized' }, { status: 404 });
        }
        // Never drop below 1 here — finishing the last pack runs the consume/survey
        // flow (deletes the row + logs). Surface that as a 409 the client falls back on.
        if (delta < 0 && row.quantity + delta < 1) {
            return NextResponse.json(
                { success: false, code: 'AT_MINIMUM', message: 'Use consume to finish the last pack' },
                { status: 409 },
            );
        }

        const now = new Date();
        const DAY = 86_400_000;
        if (delta < 0) {
            // Using a unit: log it (so partial use feeds rate-learning, not just
            // pack-finishes) and reset the lot clock so the NEXT decrement measures
            // the gap between uses = days one unit lasts. durationDays = time since
            // the last use of this lot. delta is -1 from the stepper; a larger drop
            // still records one event (good enough — the UI only sends ±1).
            // Spam protection lives in the forecast (it ignores implausibly-short
            // durations by value), so it holds no matter how the taps are timed.
            const durationDays = Math.max(1, Math.round((now.getTime() - new Date(row.purchaseDate).getTime()) / DAY));
            await ConsumptionLog.create({
                userId: session.user.id,
                productId: row.productId,
                inventoryId: String(row._id),
                consumedDate: now,
                durationDays,
                surveyCompleted: false,
                isDemo: row.isDemo,
            });
            row.purchaseDate = now;
        } else {
            // Topping up: age the lot date toward now, weighted by new vs. existing
            // units, so fresh stock doesn't read as old (same blend as addToInventory).
            const oldT = new Date(row.purchaseDate).getTime();
            row.purchaseDate = new Date(Math.round((oldT * row.quantity + now.getTime() * delta) / (row.quantity + delta)));
        }
        row.quantity += delta;
        await row.save();

        // Topping up past the low line clears the reminder; a decrement that leaves
        // ≤1 leaves it (still low). Either way the home hero/badge may shift.
        await clearAutoListIfStocked(session.user.id, row.productId);
        revalidatePath('/');
        return NextResponse.json({ success: true, message: 'Quantity updated', data: row });
    } catch (error: any) {
        return serverError('inventory.PATCH', error, 'Failed to update quantity');
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, message: 'Item ID is required' }, { status: 400 });
        }

        const deletedItem = await Inventory.findOneAndDelete({ _id: id, userId: session.user.id });

        if (!deletedItem) {
            return NextResponse.json({ success: false, message: 'Item not found or unauthorized' }, { status: 404 });
        }

        // If this was the last active lot, the product is now truly 0 stock —
        // upsert a fresh out-of-stock reminder (same pattern as the consume flow
        // in history.ts), not a resurrect-on-status-'done' — "Bought" deletes its
        // entry outright now, so there's never a done doc left to resurface.
        const stillStocked = await Inventory.countDocuments({
            userId: session.user.id,
            productId: deletedItem.productId,
            status: 'active',
        });
        if (stillStocked === 0) {
            const eff = await resolveProduct(session.user.id, deletedItem.productId);
            await ShoppingList.updateOne(
                { userId: session.user.id, productId: deletedItem.productId, source: 'auto' },
                {
                    $set: {
                        name: eff?.name || `Product ${deletedItem.productId.slice(0, 8)}`,
                        reason: 'out_of_stock',
                        status: 'pending',
                        restockQty: clampRestockQty(deletedItem.peakQty),
                        boughtAt: null,
                    },
                    $setOnInsert: { userId: session.user.id, productId: deletedItem.productId, source: 'auto' },
                },
                { upsert: true },
            );
        }

        revalidatePath('/');
        return NextResponse.json({ success: true, message: 'Item deleted' });
    } catch (error: any) {
        return serverError('inventory.DELETE', error, 'Failed to delete item');
    }
}

import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import connectDB from '@/lib/mongodb';
import { ShoppingList, Product, Inventory } from '@/lib/models';
import { buildForecasts, isLow } from '@/lib/forecast';
import { addToInventory } from '@/lib/inventory';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

/**
 * Shopping list = what you still need to buy.
 *
 *  GET    -> auto-syncs from run-out forecasts, then returns the list.
 *  POST   -> add a free-text manual item.
 *  PATCH  -> check ("got it" → re-adds auto items to inventory) / uncheck / dismiss.
 *  DELETE -> remove an entry (manual items).
 *
 * Auto entries mirror the forecast: created when a product goes low, removed once
 * it's restocked. Manual entries are never auto-touched. Dismissed auto entries
 * stay suppressed only while the product remains low.
 */

const MAX_NAME = 100;
const clampQty = (qty: unknown) => Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));

// Deterministic catalogue id for a hand-typed item, so re-adding the same name
// resolves to one shared Product instead of duplicating it. Mirrors the scan
// page's manual-entry id scheme (MANUAL-…).
const manualId = (name: string) =>
    `MANUAL-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)}`;

async function requireUser() {
    const session = await auth();
    return session?.user?.id ?? null;
}

/** Reconcile auto entries with the current forecast. */
async function autoSync(userId: string) {
    const forecasts = await buildForecasts(userId);
    const low = forecasts.filter(isLow);
    const lowIds = low.map((p) => p.productId);
    const activeRows = lowIds.length
        ? await Inventory.find({ userId, productId: { $in: lowIds }, status: 'active' }).select('productId peakQty').lean()
        : [];
    const rememberedQty = new Map(
        activeRows
            .filter((row) => row.peakQty)
            .map((row) => [row.productId, clampQty(row.peakQty)]),
    );

    // Drop auto entries whose product is no longer low (cleans resolved / bought /
    // dismissed) so a later dip re-suggests it fresh.
    await ShoppingList.deleteMany({
        userId,
        source: 'auto',
        productId: { $nin: lowIds },
    });

    // Upsert one pending auto entry per low product. $setOnInsert keeps the status
    // so a previously dismissed (still-low) entry is NOT resurrected to pending;
    // name/reason are refreshed each sync. Unique partial index makes this race-safe.
    await Promise.all(
        low.map((p) => {
            const set: Record<string, unknown> = {
                name: p.name,
                reason: p.status === 'out_of_stock' ? 'out_of_stock' : 'low_stock',
            };
            const qty = rememberedQty.get(p.productId);
            if (qty) set.restockQty = qty;
            const setOnInsert: Record<string, unknown> = { userId, productId: p.productId, source: 'auto', status: 'pending' };
            if (!qty) setOnInsert.restockQty = 1;
            return ShoppingList.updateOne(
                { userId, productId: p.productId, source: 'auto' },
                {
                    $set: set,
                    $setOnInsert: setOnInsert,
                },
                { upsert: true },
            );
        }),
    );
}

const REASON_RANK: Record<string, number> = { out_of_stock: 0, low_stock: 1, manual: 2 };

export async function GET(request: Request) {
    try {
        const userId = await requireUser();
        if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

        await connectDB();

        // Lightweight count used by the home badge — no autoSync, just a fast query.
        if (new URL(request.url).searchParams.has('count')) {
            const count = await ShoppingList.countDocuments({ userId, status: 'pending' });
            return NextResponse.json({ success: true, count });
        }

        await autoSync(userId);

        // Return all statuses so the client can show a Dismissed section where
        // the user can restore items they accidentally or prematurely dismissed.
        const entries = await ShoppingList.find({ userId, status: { $in: ['pending', 'done', 'dismissed'] } }).lean();

        // Enrich auto/catalogue items with brand, image and pack size.
        const barcodes = [...new Set(entries.filter((e) => e.productId).map((e) => e.productId as string))];
        const products = barcodes.length
            ? await Product.find({ barcode: { $in: barcodes } }).select('barcode brand imageUrl defaultUnit').lean()
            : [];
        const pmap = new Map(products.map((p) => [p.barcode, p]));

        const items = entries
            .map((e) => {
                const p = e.productId ? pmap.get(e.productId) : null;
                return {
                    _id: String(e._id),
                    productId: e.productId ?? null,
                    name: e.name,
                    brand: p?.brand || '',
                    imageUrl: p?.imageUrl || null,
                    unit: p?.defaultUnit || null,
                    reason: e.reason,
                    source: e.source,
                    status: e.status,
                    restockQty: e.restockQty ?? 1,
                    boughtAt: e.boughtAt ?? null,
                };
            })
            .sort((a, b) => {
                // pending before done; within that, by reason rank then name.
                if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
                const r = (REASON_RANK[a.reason] ?? 9) - (REASON_RANK[b.reason] ?? 9);
                return r !== 0 ? r : a.name.localeCompare(b.name);
            });

        revalidatePath('/');
        return NextResponse.json({
            success: true,
            data: {
                items,
                counts: {
                    pending: items.filter((i) => i.status === 'pending').length,
                    done: items.filter((i) => i.status === 'done').length,
                    dismissed: items.filter((i) => i.status === 'dismissed').length,
                },
            },
        });
    } catch (error: any) {
        return serverError('shopping-list', error);
    }
}

export async function POST(request: Request) {
    try {
        const userId = await requireUser();
        if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const name = (body.name || '').toString().trim().slice(0, MAX_NAME);
        if (!name) {
            return NextResponse.json({ success: false, message: 'Item name is required' }, { status: 400 });
        }

        await connectDB();

        // A hand-typed item is a real product, exactly like a manual scan entry:
        // upsert a catalogue Product (no separate model) and tie the list entry to
        // it via productId, so ticking "Got it" adds it to inventory like any other
        // product. $setOnInsert leaves a richer existing entry (e.g. later scanned
        // with brand/size) untouched.
        const productId = manualId(name);
        await Product.findOneAndUpdate(
            { barcode: productId },
            {
                $setOnInsert: {
                    barcode: productId,
                    name,
                    category: 'Other',
                    defaultUnit: 'units',
                    averageDuration: 14,
                    addedBy: 'manual',
                    source: 'manual',
                    aiPredicted: false,
                    isDemo: false,
                },
            },
            { upsert: true },
        );

        const entry = await ShoppingList.create({
            userId,
            productId,
            name,
            reason: 'manual',
            source: 'manual',
            status: 'pending',
        });

        revalidatePath('/');
        return NextResponse.json({ success: true, data: { _id: String(entry._id) } });
    } catch (error: any) {
        return serverError('shopping-list', error);
    }
}

export async function PATCH(request: Request) {
    try {
        const userId = await requireUser();
        if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

        const body = await request.json();
        const id = (body.id || '').toString();
        const action = (body.action || '').toString();
        // Optional rebuy count from the list's quantity stepper (clamped); null = not sent.
        const reqQty = body.qty === undefined ? null : clampQty(body.qty);
        if (!id) return NextResponse.json({ success: false, message: 'id is required' }, { status: 400 });
        if (!['check', 'uncheck', 'dismiss', 'resetQty'].includes(action)) {
            return NextResponse.json({ success: false, message: 'invalid action' }, { status: 400 });
        }

        await connectDB();
        const entry = await ShoppingList.findOne({ _id: id, userId });
        if (!entry) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

        if (action === 'check') {
            // "Got it": add the item to inventory exactly once, in the quantity the
            // user dialed (default 1). Works for any entry tied to a product — auto
            // (forecast) or manual (hand-typed, now a real catalogue product).
            // boughtAt guards against a double add if they uncheck and re-check.
            if (entry.productId && (entry.status !== 'done' || !entry.boughtAt)) {
                const addQty = reqQty ?? clampQty(entry.restockQty);
                const inventoryItem = await addToInventory(userId, entry.productId, addQty);
                inventoryItem.peakQty = addQty;
                await inventoryItem.save();
                entry.restockQty = addQty;
                entry.boughtAt = new Date();
            }
            entry.status = 'done';
        } else if (action === 'uncheck') {
            entry.status = 'pending';
            // Clear boughtAt so a re-check adds to inventory again (user is saying
            // they didn't actually buy it, so the guard should reset).
            entry.boughtAt = null as unknown as Date;
        } else if (action === 'dismiss') {
            // Manual items have no auto-delete recovery path — dismissing one would
            // hide it permanently with no way to retrieve it.
            if (entry.source !== 'auto') {
                return NextResponse.json({ success: false, message: 'Manual items cannot be dismissed' }, { status: 400 });
            }
            entry.status = 'dismissed';
        } else if (action === 'resetQty') {
            if (!entry.productId) {
                return NextResponse.json({ success: false, message: 'Item has no product quantity to reset' }, { status: 400 });
            }
            entry.restockQty = 1;
            await Inventory.updateMany(
                { userId, productId: entry.productId, status: 'active' },
                { $set: { peakQty: 1 } },
            );
        }
        await entry.save();

        revalidatePath('/');
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return serverError('shopping-list', error);
    }
}

export async function DELETE(request: Request) {
    try {
        const userId = await requireUser();
        if (!userId) return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(request.url);
        let id = searchParams.get('id');
        if (!id) {
            const body = await request.json().catch(() => ({}));
            id = (body.id || '').toString();
        }
        if (!id) return NextResponse.json({ success: false, message: 'id is required' }, { status: 400 });

        await connectDB();
        const res = await ShoppingList.findOneAndDelete({ _id: id, userId });
        if (!res) return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });

        revalidatePath('/');
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return serverError('shopping-list', error);
    }
}

import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { Product, Inventory, ConsumptionLog, User } from '@/lib/models';
import { auth } from '@/auth';

/**
 * Demo onboarding data.
 *
 *  POST  -> seed a realistic household so a brand-new user immediately sees a
 *           populated inventory, history and working predictions. Idempotent:
 *           only seeds once (guarded by user.demoSeeded).
 *  DELETE-> wipe every demo-tagged record for this user so they can start clean.
 *
 * All demo records are tagged { isDemo: true } and demo products are barcode-scoped
 * per user (`DEMO-<userId>-<KEY>`) so removal never touches another user's data.
 */

type DemoDef = {
    key: string;
    name: string;
    brand: string;
    category: string;
    unit: string;
    avg: number; // expected days a unit lasts
    inStock: boolean;
    logs: number[]; // past consumption durations (days)
};

const DEMO: DemoDef[] = [
    { key: 'MILK', name: 'Toned Milk (1L)', brand: 'Amul', category: 'Dairy & Eggs', unit: 'packet', avg: 3, inStock: true, logs: [3, 2, 4] },
    { key: 'BISCUIT', name: 'Marie Gold (250g)', brand: 'Britannia', category: 'Snacks', unit: 'pack', avg: 6, inStock: true, logs: [6, 7, 5] },
    { key: 'BREAD', name: 'Whole Wheat Bread', brand: 'Modern', category: 'Bakery', unit: 'loaf', avg: 4, inStock: true, logs: [4, 5] },
    { key: 'OIL', name: 'Sunflower Oil (1L)', brand: 'Fortune', category: 'Pantry', unit: 'bottle', avg: 22, inStock: true, logs: [22, 20] },
    { key: 'RICE', name: 'Basmati Rice (5kg)', brand: 'India Gate', category: 'Pantry', unit: 'bag', avg: 34, inStock: true, logs: [34] },
    { key: 'ATTA', name: 'Whole Wheat Atta (5kg)', brand: 'Aashirvaad', category: 'Pantry', unit: 'bag', avg: 26, inStock: false, logs: [26, 28] },
    { key: 'TEA', name: 'Tea Powder (500g)', brand: 'Tata Tea', category: 'Beverages', unit: 'pack', avg: 21, inStock: false, logs: [21] },
];

const DAY = 24 * 60 * 60 * 1000;

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const uid = session.user.id;
        // The dev test user has no DB record (non-ObjectId id) — nothing to seed.
        if (!mongoose.Types.ObjectId.isValid(uid)) {
            return NextResponse.json({ success: true, seeded: false, message: 'No demo for test user' });
        }

        await connectDB();

        // Atomically claim the seed: only the first request to flip demoSeeded
        // false->true proceeds. This is race-safe against React StrictMode's
        // double-invoked effects (which fire two concurrent POSTs in dev).
        const user = await User.findOneAndUpdate(
            { _id: uid, demoSeeded: { $ne: true } },
            { $set: { demoSeeded: true } },
            { new: false },
        );
        if (!user) {
            return NextResponse.json({ success: true, seeded: false, message: 'Demo already seeded' });
        }

        for (const d of DEMO) {
            const barcode = `DEMO-${uid}-${d.key}`;

            await Product.findOneAndUpdate(
                { barcode },
                {
                    $set: {
                        barcode,
                        name: d.name,
                        brand: d.brand,
                        category: d.category,
                        defaultUnit: d.unit,
                        averageDuration: d.avg,
                        addedBy: 'demo',
                        source: 'demo',
                        isDemo: true,
                        imageUrl: null,
                    },
                },
                { upsert: true, new: true },
            );

            // Past consumption logs -> gives each product a learned rate/history.
            let cursor = Date.now() - 5 * DAY;
            for (const dur of d.logs) {
                cursor -= dur * DAY;
                await ConsumptionLog.create({
                    userId: uid,
                    productId: barcode,
                    inventoryId: 'demo',
                    consumedDate: new Date(cursor),
                    durationDays: dur,
                    surveyCompleted: true,
                    isDemo: true,
                    surveyData: { userReportedDays: dur, familySize: user?.familySize || 4, flagged: false, notes: '' },
                });
            }

            // Current stock -> enables run-out predictions for in-stock items.
            if (d.inStock) {
                await Inventory.create({
                    userId: uid,
                    productId: barcode,
                    quantity: 1,
                    unit: d.unit,
                    purchaseDate: new Date(Date.now() - Math.floor(d.avg / 2) * DAY),
                    status: 'active',
                    isDemo: true,
                });
            }
        }

        return NextResponse.json({ success: true, seeded: true, count: DEMO.length });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();
        const uid = session.user.id;

        const inv = await Inventory.deleteMany({ userId: uid, isDemo: true });
        const logs = await ConsumptionLog.deleteMany({ userId: uid, isDemo: true });
        const prods = await Product.deleteMany({ isDemo: true, barcode: new RegExp(`^DEMO-${uid}-`) });

        return NextResponse.json({
            success: true,
            removed: { inventory: inv.deletedCount, logs: logs.deletedCount, products: prods.deletedCount },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

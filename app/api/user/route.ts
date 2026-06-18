import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { User, Inventory, Product } from '@/lib/models';
import { predictProductMeta } from '@/lib/gemini';
import { auth } from '@/auth';

/**
 * Re-estimate shelf-life for every active (non-demo) product the user holds,
 * using their NEW household size. Durations live in the shared catalogue, so we
 * only refresh the products this user actually has in stock. Runs in the
 * background (fire-and-forget) so the settings save returns instantly.
 */
async function reestimateForHousehold(
    userId: string,
    householdSize: number,
    prevHouseholdSize: number,
    daysAtPreviousSize: number,
) {
    const inv = await Inventory.find({ userId, status: 'active', isDemo: { $ne: true } }).select('productId').lean();
    const barcodes = [...new Set(inv.map((i) => i.productId))];
    // Personal Care items are individually used (each person has their own deodorant /
    // toothpaste / shampoo). Their shelf-life doesn't change with household size.
    const products = await Product.find({
        barcode: { $in: barcodes },
        isDemo: { $ne: true },
        category: { $ne: 'Personal Care' },
    }).lean();
    for (const p of products) {
        try {
            const meta = await predictProductMeta(p.name, p.brand || '', p.category, p.defaultUnit || 'units', {
                flavor: p.flavor || undefined,
                price: p.price || undefined,
                householdSize,
                prevHouseholdSize,
                daysAtPreviousSize,
            });
            if (meta.predicted) {
                await Product.updateOne(
                    { barcode: p.barcode },
                    { $set: { averageDuration: meta.averageDuration, category: meta.category, aiPredicted: true } },
                );
            }
        } catch (err) {
            console.warn(`Re-estimate failed for ${p.barcode}:`, err);
        }
    }
}

/**
 * User profile / household settings. Reads and writes the same `users` document
 * created by the NextAuth MongoDB adapter (familySize, survey preference, demo flag).
 */

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        // The dev test user has a non-ObjectId id and no DB record — serve defaults.
        if (!mongoose.Types.ObjectId.isValid(session.user.id)) {
            return NextResponse.json({
                success: true,
                data: { name: session.user.name || 'User', familySize: 1, surveyFrequency: 'occasional', demoSeeded: true, tourCompleted: true },
            });
        }

        await connectDB();
        const user = await User.findById(session.user.id).lean();
        const familySize = user?.familySize ?? 1;

        return NextResponse.json({
            success: true,
            data: {
                name: session.user.name || user?.displayName || 'User',
                familySize,
                surveyFrequency: user?.preferences?.surveyFrequency ?? 'occasional',
                demoSeeded: user?.demoSeeded ?? false,
                tourCompleted: user?.tourCompleted ?? false,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        // Test user isn't persisted — accept the change as a no-op so the UI works.
        if (!mongoose.Types.ObjectId.isValid(session.user.id)) {
            const body = await request.json().catch(() => ({}));
            return NextResponse.json({
                success: true,
                data: { familySize: body.familySize ?? 1, surveyFrequency: body.surveyFrequency ?? 'occasional' },
            });
        }

        await connectDB();
        const body = await request.json();
        const current = await User.findById(session.user.id).select('familySize').lean();

        const update: Record<string, any> = {};
        if (typeof body.familySize === 'number') {
            update.familySize = Math.max(1, Math.min(20, Math.round(body.familySize)));
        }
        if (body.surveyFrequency === 'always' || body.surveyFrequency === 'occasional') {
            update['preferences.surveyFrequency'] = body.surveyFrequency;
        }
        if (typeof body.tourCompleted === 'boolean') {
            update.tourCompleted = body.tourCompleted;
        }

        // Grab the PREVIOUS doc so we can tell if family size actually changed.
        const prev = await User.findByIdAndUpdate(session.user.id, { $set: update }, { new: false }).lean();
        const oldFamily = prev?.familySize ?? 1;
        const newFamily = typeof update.familySize === 'number' ? update.familySize : oldFamily;
        const newSurvey = update['preferences.surveyFrequency'] ?? prev?.preferences?.surveyFrequency ?? 'occasional';

        let reestimating = 0;
        if (newFamily !== oldFamily) {
            // How long did the household sit at the old size? Used to give the AI
            // usage-history context so it can confirm or correct its per-person rate.
            const changedAt = prev?.familySizeChangedAt ? new Date(prev.familySizeChangedAt) : null;
            const daysAtPreviousSize = changedAt
                ? Math.floor((Date.now() - changedAt.getTime()) / 86_400_000)
                : 0;

            // Record the transition so the next change has history to draw on.
            await User.updateOne(
                { _id: session.user.id },
                { $set: { prevFamilySize: oldFamily, familySizeChangedAt: new Date() } },
            );

            const inv = await Inventory.find({ userId: session.user.id, status: 'active', isDemo: { $ne: true } }).select('productId').lean();
            const barcodes = [...new Set(inv.map((i) => i.productId))];
            // Count excludes Personal Care (not re-estimated — shelf-life is per-person)
            const count = await Product.countDocuments({
                barcode: { $in: barcodes },
                isDemo: { $ne: true },
                category: { $ne: 'Personal Care' },
            });
            reestimating = count;
            void reestimateForHousehold(session.user.id, newFamily, oldFamily, daysAtPreviousSize);
        }

        return NextResponse.json({
            success: true,
            data: { familySize: newFamily, surveyFrequency: newSurvey, reestimating },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

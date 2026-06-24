import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { User, Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

/**
 * Re-estimate shelf-life for every active (non-demo) product the user holds,
 * using their NEW household size. Durations live in the shared catalogue, so we
 * only refresh the products this user actually has in stock. Runs in the
 * background (fire-and-forget) so the settings save returns instantly.
 */
// Pure-math re-estimation — no AI calls. Uses the stored perPersonDailyRate
// (set at scan time) or falls back to linear scaling from the current duration.
async function reestimateForHousehold(userId: string, newN: number, oldN: number) {
    const inv = await Inventory.find({ userId, status: 'active', isDemo: { $ne: true } }).select('productId').lean();
    const barcodes = [...new Set(inv.map((i) => i.productId))];
    // Personal Care items are per-person — duration never changes with household size.
    const products = await Product.find({
        barcode: { $in: barcodes },
        isDemo: { $ne: true },
        category: { $ne: 'Personal Care' },
    }).select('barcode averageDuration perPersonDailyRate').lean();

    await Promise.all(products.map((p) => {
        // Always estimate from a fixed per-person rate, never from the previous
        // (already-rounded) duration — rescaling the rounded value compounds error
        // and drifts on repeated changes (e.g. N 1→4→1 wouldn't return to start).
        let rate = p.perPersonDailyRate;
        const set: Record<string, number> = {};
        if (!rate || rate <= 0) {
            // Legacy product: back-derive the rate once from current duration & size,
            // persist it so every future change uses the stable precise path.
            rate = 1 / (Math.max(1, p.averageDuration) * Math.max(1, oldN));
            set.perPersonDailyRate = rate;
        }
        set.averageDuration = Math.max(1, Math.round(1 / (rate * newN)));
        return Product.updateOne({ barcode: p.barcode }, { $set: set });
    }));

    console.log(`Re-estimated ${products.length} products for household ${oldN}→${newN} (math-only, no AI)`);
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
        return serverError('user', error);
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
            const now = new Date();
            // Maintain the size-over-time log used for time-weighted depletion.
            // Seed a baseline at the user's creation the first time, so history
            // before this change is attributed to the OLD size, not the new one.
            const log = (prev?.familySizeLog as { size: number; from: Date }[] | undefined) ?? [];
            if (log.length === 0) {
                log.push({ size: oldFamily, from: prev?.createdAt ?? new Date(0) });
            }
            log.push({ size: newFamily, from: now });

            // Record the transition for audit/history purposes.
            await User.updateOne(
                { _id: session.user.id },
                { $set: { prevFamilySize: oldFamily, familySizeChangedAt: now, familySizeLog: log } },
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
            void reestimateForHousehold(session.user.id, newFamily, oldFamily);
        }

        return NextResponse.json({
            success: true,
            data: { familySize: newFamily, surveyFrequency: newSurvey, reestimating },
        });
    } catch (error: any) {
        return serverError('user', error);
    }
}

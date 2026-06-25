import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

export async function GET() {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        await connectDB();

        // Fetch logs ONLY for the logged-in user
        const logs = await ConsumptionLog.find({ userId: session.user.id })
            .sort({ consumedDate: -1 })
            .limit(50)
            .lean();

        // Populate product details for each log
        const enrichedLogs = await Promise.all(logs.map(async (log) => {
            const product = await Product.findOne({ barcode: log.productId });
            return {
                ...log,
                productDetails: product ? {
                    name: product.name,
                    brand: product.brand,
                    category: product.category,
                    imageUrl: product.imageUrl,
                    flavor: product.flavor
                } : null
            };
        }));

        return NextResponse.json({
            success: true,
            data: enrichedLogs
        });
    } catch (error: any) {
        return serverError('history.GET', error, 'Failed to fetch history');
    }
}

export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        await connectDB();
        const body = await request.json();

        const inventoryId = (body.inventoryId || '').toString();
        const durationDays = Number(body.durationDays) || 0;
        const sd = body.surveyData;

        // Owner-checked inventory row (if any) — tells us remaining stock + demo flag.
        const row = mongoose.Types.ObjectId.isValid(inventoryId)
            ? await Inventory.findOne({ _id: inventoryId, userId: session.user.id })
            : null;

        // Persist the survey too — schema stores it and the client sends it; the old
        // code dropped surveyData and left surveyCompleted false, so anomaly/notes/
        // household context never landed.
        const newLog = await ConsumptionLog.create({
            userId: session.user.id,
            productId: (body.productId || row?.productId || 'unknown').toString(),
            inventoryId: inventoryId || 'unknown',
            consumedDate: new Date(),
            durationDays,
            surveyCompleted: !!sd,
            isDemo: row?.isDemo ?? false,
            surveyData: sd
                ? {
                    userReportedDays: Number(sd.userReportedDays) || durationDays,
                    familySize: Number(sd.familySize) || 1,
                    flagged: !!sd.flagged,
                    notes: (sd.notes || '').toString(),
                }
                : undefined,
        });

        // Finish ONE pack: decrement a multi-pack (and reset the lot clock so the
        // next consume measures the real per-pack duration), delete only the last
        // one. The old code deleted the whole row, wiping remaining packs.
        if (row) {
            if (row.quantity > 1) {
                row.quantity -= 1;
                row.purchaseDate = new Date();
                await row.save();
            } else {
                await row.deleteOne();
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Consumption logged',
            data: newLog,
        });
    } catch (error: any) {
        return serverError('history.POST', error, 'Failed to log consumption');
    }
}

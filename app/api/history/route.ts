import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';

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
        return NextResponse.json({
            success: false,
            message: 'Failed to fetch history',
            error: error.message
        }, { status: 500 });
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

        // Create consumption log for the authenticated user
        const newLog = await ConsumptionLog.create({
            userId: session.user.id,
            productId: body.productId,
            inventoryId: body.inventoryId,
            consumedDate: new Date(),
            durationDays: body.durationDays || 0,
            surveyCompleted: false
        });

        // Delete the inventory item (product consumed completely)
        // Ensure we only delete if the user owns this inventory item
        await Inventory.findOneAndDelete(
            { _id: body.inventoryId, userId: session.user.id }
        );

        return NextResponse.json({
            success: true,
            message: 'Consumption logged',
            data: newLog
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            message: 'Failed to log consumption',
            error: error.message
        }, { status: 500 });
    }
}

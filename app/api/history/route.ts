import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { ConsumptionLog, Inventory } from '@/lib/models';

export async function GET() {
    try {
        await connectDB();

        const logs = await ConsumptionLog.find()
            .sort({ consumedDate: -1 })
            .limit(50);

        return NextResponse.json({
            success: true,
            data: logs
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
        await connectDB();
        const body = await request.json();

        // Create consumption log
        const newLog = await ConsumptionLog.create({
            userId: body.userId || 'demo_user',
            productId: body.productId,
            inventoryId: body.inventoryId,
            consumedDate: new Date(),
            durationDays: body.durationDays || 0,
            surveyCompleted: false
        });

        // Update inventory status
        await Inventory.findByIdAndUpdate(body.inventoryId, {
            status: 'consumed'
        });

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

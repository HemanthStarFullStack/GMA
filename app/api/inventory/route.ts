import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Inventory, Product } from '@/lib/models';

export async function GET() {
    try {
        await connectDB();

        // Fetch inventory with product details
        // Note: In a real app, we'd filter by userId from auth session
        const inventoryItems = await Inventory.find()
            .sort({ purchaseDate: -1 });

        // Manually populate product details since we're using separate collections
        // and might not have strict references set up for population yet
        const populatedItems = await Promise.all(inventoryItems.map(async (item) => {
            const product = await Product.findOne({ barcode: item.productId });
            return {
                ...item.toObject(),
                product: product || { name: 'Unknown Product', brand: '', imageUrl: null }
            };
        }));

        return NextResponse.json({
            success: true,
            data: populatedItems
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            message: 'Failed to fetch inventory',
            error: error.message
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        await connectDB();
        const body = await request.json();

        // If productDetails are provided, create or update the Product
        if (body.productDetails) {
            await Product.findOneAndUpdate(
                { barcode: body.productId },
                {
                    name: body.productDetails.name,
                    brand: body.productDetails.brand,
                    flavor: body.productDetails.flavor, // Added flavor
                    category: body.productDetails.category || 'Other',
                    imageUrl: body.productDetails.imageUrl,
                    defaultUnit: body.productDetails.unit || 'units',
                    addedBy: body.productDetails.addedBy || 'bar',
                    confidence: body.productDetails.confidence || 1.0
                },
                { upsert: true, new: true }
            );
        }

        // Create inventory item
        const newItem = await Inventory.create({
            userId: body.userId || 'demo_user', // Fallback for now
            productId: body.productId, // This is the barcode or AI-ID
            quantity: body.quantity || 1,
            unit: body.unit || 'units',
            purchaseDate: new Date(),
            status: 'active'
        });

        return NextResponse.json({
            success: true,
            message: 'Item added to inventory',
            data: newItem
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            message: 'Failed to add item',
            error: error.message
        }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        await connectDB();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({
                success: false,
                message: 'Item ID is required'
            }, { status: 400 });
        }

        await Inventory.findByIdAndDelete(id);

        return NextResponse.json({
            success: true,
            message: 'Item deleted'
        });
    } catch (error: any) {
        return NextResponse.json({
            success: false,
            message: 'Failed to delete item',
            error: error.message
        }, { status: 500 });
    }
}

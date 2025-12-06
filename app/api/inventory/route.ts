import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';

export async function GET() {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        await connectDB();

        // Fetch inventory ONLY for the logged-in user
        const inventoryItems = await Inventory.find({ userId: session.user.id })
            .sort({ purchaseDate: -1 });

        // Manually populate product details
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
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        await connectDB();
        const body = await request.json();

        // If productDetails are provided, create or update the Product
        if (body.productDetails) {
            await Product.findOneAndUpdate(
                { barcode: body.productId },
                {
                    name: body.productDetails.name,
                    brand: body.productDetails.brand,
                    flavor: body.productDetails.flavor,
                    category: body.productDetails.category || 'Other',
                    imageUrl: body.productDetails.imageUrl,
                    defaultUnit: body.productDetails.unit || 'units',
                    addedBy: body.productDetails.addedBy || 'bar',
                    confidence: body.productDetails.confidence || 1.0
                },
                { upsert: true, new: true }
            );
        }

        // Create inventory item linked to the USER
        const newItem = await Inventory.create({
            userId: session.user.id, // Enforce authenticated user ID
            productId: body.productId,
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
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
        }

        await connectDB();
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, message: 'Item ID is required' }, { status: 400 });
        }

        // Ensure user can only delete their own items
        const deletedItem = await Inventory.findOneAndDelete({ _id: id, userId: session.user.id });

        if (!deletedItem) {
            return NextResponse.json({ success: false, message: 'Item not found or unauthorized' }, { status: 404 });
        }

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

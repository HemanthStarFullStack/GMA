import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Inventory, Product } from '@/lib/models';
import { auth } from '@/auth';

export async function GET() {
    try {
        const session = await auth();
        if (!session || !session.user || !session.user.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        await connectDB();

        const inventoryItems = await Inventory.find({ userId: session.user.id }).sort({ purchaseDate: -1 }).lean();

        // Join product details by barcode (productId === barcode everywhere).
        const barcodes = [...new Set(inventoryItems.map((i) => i.productId))];
        const products = await Product.find({ barcode: { $in: barcodes } }).lean();
        const productMap = new Map(products.map((p) => [p.barcode, p]));

        const populatedItems = inventoryItems.map((item) => {
            const product = productMap.get(item.productId);
            return {
                ...item,
                product: product || { name: 'Unknown Product', brand: '', imageUrl: null, averageDuration: 14 },
            };
        });

        return NextResponse.json({ success: true, data: populatedItems });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Failed to fetch inventory', error: error.message },
            { status: 500 },
        );
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

        // Cache the product in the shared catalogue. Don't clobber an existing
        // entry's good data — only fill in fields on first insert.
        const d = body.productDetails;
        if (d) {
            await Product.findOneAndUpdate(
                { barcode },
                {
                    $setOnInsert: {
                        barcode,
                        name: d.name || 'Unknown Product',
                        brand: d.brand || '',
                        flavor: d.flavor || '',
                        category: d.category || 'Other',
                        imageUrl: d.imageUrl || null,
                        defaultUnit: d.unit || 'units',
                        averageDuration: d.averageDuration || 14,
                        addedBy: d.addedBy || 'barcode',
                        source: d.source || 'barcode',
                        isDemo: false,
                    },
                },
                { upsert: true, new: true },
            );
        }

        const qty = body.quantity || 1;
        const unit = body.unit || d?.unit || 'units';

        // If an active entry for this product already exists for the user,
        // increment its quantity rather than creating a duplicate row.
        const existing = await Inventory.findOneAndUpdate(
            { userId: session.user.id, productId: barcode, status: 'active' },
            { $inc: { quantity: qty } },
            { new: true },
        );

        if (existing) {
            return NextResponse.json({ success: true, message: 'Quantity updated', data: existing });
        }

        const newItem = await Inventory.create({
            userId: session.user.id,
            productId: barcode,
            quantity: qty,
            unit,
            purchaseDate: new Date(),
            status: 'active',
            isDemo: false,
        });

        return NextResponse.json({ success: true, message: 'Item added to inventory', data: newItem });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Failed to add item', error: error.message },
            { status: 500 },
        );
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

        return NextResponse.json({ success: true, message: 'Item deleted' });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Failed to delete item', error: error.message },
            { status: 500 },
        );
    }
}

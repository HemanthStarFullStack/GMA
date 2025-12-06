import { NextResponse } from 'next/server';

/**
 * Barcode Lookup Service
 * Providers:
 * 1. UPCitemDB (Trial) - Good for US/International
 * 2. OpenFoodFacts - Good for Groceries/Global
 */

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const barcode = searchParams.get('barcode');

        if (!barcode) {
            return NextResponse.json({ success: false, message: 'Barcode is required' }, { status: 400 });
        }

        let productData = null;
        let source = 'none';

        // 1. Try UPCitemDB first
        try {
            console.log(`Lookup: Checking UPCitemDB for ${barcode}`);
            const upcRes = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`);
            const upcData = await upcRes.json();

            if (upcRes.ok && upcData.items && upcData.items.length > 0) {
                const item = upcData.items[0];
                productData = {
                    barcode: item.ean || item.upc || barcode,
                    name: item.title,
                    brand: item.brand || 'Unknown Brand',
                    category: item.category || 'Other',
                    description: item.description || '',
                    imageUrl: (item.images && item.images.length > 0) ? item.images[0] : null,
                    quantity: '',
                    unit: 'units', // Default
                    confidence: 0.9,
                    addedBy: 'barcode-upcdb'
                };
                source = 'UPCitemDB';
            }
        } catch (err) {
            console.warn('UPCitemDB lookup failed:', err);
        }

        // 2. Fallback to OpenFoodFacts if not found
        if (!productData) {
            try {
                console.log(`Lookup: Checking OpenFoodFacts for ${barcode}`);
                const offRes = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
                    headers: { 'User-Agent': 'SINTI-App/1.0' }
                });
                const offData = await offRes.json();

                if (offData.status === 1 && offData.product) {
                    const p = offData.product;
                    productData = {
                        barcode: p.code || barcode,
                        name: p.product_name || p.product_name_en || 'Unknown Product',
                        brand: p.brands || 'Unknown Brand',
                        category: p.categories?.split(',')[0] || 'Uncategorized',
                        description: p.generic_name || '',
                        imageUrl: p.image_url || p.image_front_url || null,
                        quantity: p.quantity || null,
                        ingredients: p.ingredients_text || null,
                        nutritionGrade: p.nutrition_grades || null,
                        confidence: 0.9,
                        addedBy: 'barcode-off'
                    };
                    source = 'OpenFoodFacts';
                }
            } catch (err) {
                console.warn('OpenFoodFacts lookup failed:', err);
            }
        }

        // 3. Return Result or Not Found
        if (productData) {
            return NextResponse.json({
                success: true,
                source: source,
                data: productData
            });
        } else {
            return NextResponse.json({
                success: false,
                message: 'Product not found in any database',
                code: 'NOT_FOUND'
            }, { status: 404 });
        }

    } catch (error: any) {
        console.error('Barcode lookup error:', error);
        return NextResponse.json({
            success: false,
            message: 'Internal server error during lookup',
            error: error.message
        }, { status: 500 });
    }
}

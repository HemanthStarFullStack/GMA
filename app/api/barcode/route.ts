import { NextResponse } from 'next/server';

/**
 * Open Food Facts API
 * Completely free, no signup required, excellent for food/grocery products
 * Endpoint: https://world.openfoodfacts.org/api/v2/product/{barcode}
 */

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const barcode = searchParams.get('barcode');

        if (!barcode) {
            return NextResponse.json({ success: false, message: 'Barcode is required' }, { status: 400 });
        }

        // Call Open Food Facts API
        const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
            method: 'GET',
            headers: {
                'User-Agent': 'SINTI-App/1.0',
            }
        });

        const data = await response.json();

        if (data.status === 1 && data.product) {
            // Product found!
            const product = data.product;

            return NextResponse.json({
                success: true,
                data: {
                    barcode: product.code || barcode,
                    name: product.product_name || product.product_name_en || 'Unknown Product',
                    brand: product.brands || 'Unknown Brand',
                    category: product.categories || 'Uncategorized',
                    description: product.generic_name || '',
                    imageUrl: product.image_url || product.image_front_url || null,
                    quantity: product.quantity || null,
                    ingredients: product.ingredients_text || null,
                    nutritionGrade: product.nutrition_grades || null,
                    stores: product.stores || null,
                }
            });
        } else {
            // Product not found
            return NextResponse.json({
                success: false,
                message: 'Product not found in Open Food Facts database',
                code: 'NOT_FOUND'
            }, { status: 404 });
        }

    } catch (error: any) {
        console.error('Open Food Facts lookup error:', error);
        return NextResponse.json({
            success: false,
            message: 'Failed to lookup barcode',
            error: error.message
        }, { status: 500 });
    }
}

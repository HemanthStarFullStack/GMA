import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Product, Inventory } from '@/lib/models';
import { findProductImageUrls } from '@/lib/web-search';
import { findBestProductImage } from '@/lib/verify-image';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

/**
 * Download and save the verified image locally
 */
async function downloadVerifiedImage(url: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            const ext = path.extname(new URL(url).pathname) || '.jpg';
            const filename = `img_${crypto.randomBytes(4).toString('hex')}${ext}`;
            const relativePath = `/uploads/products/${filename}`;
            const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

            // Ensure directory exists
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const file = fs.createWriteStream(fullPath);

            const request = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(fullPath, () => { });
                    resolve(null);
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve(relativePath);
                });
            });

            request.on('error', (err) => {
                file.close();
                fs.unlink(fullPath, () => { });
                resolve(null);
            });

            request.setTimeout(10000, () => {
                request.destroy();
                file.close();
                fs.unlink(fullPath, () => { });
                resolve(null);
            });
        } catch (error) {
            resolve(null);
        }
    });
}

export async function POST(request: Request) {
    try {
        await connectDB();

        const body = await request.json();
        const { barcode, name, brand, category, flavor } = body;

        if (!barcode || !name) {
            return NextResponse.json({
                success: false,
                error: 'Barcode and name are required'
            }, { status: 400 });
        }

        // Check if product already exists
        const existing = await Product.findOne({ barcode });
        if (existing) {
            // If product exists, increase inventory quantity for the user (if provided)
            const { userId, quantity = 1 } = body;
            if (userId) {
                // Find existing inventory entry for this user and product
                const inventoryItem = await Inventory.findOne({ userId, productId: existing._id });
                if (inventoryItem) {
                    inventoryItem.quantity += quantity;
                    await inventoryItem.save();
                    console.log(`🔄 Incremented inventory for user ${userId}, product ${barcode} by ${quantity}`);
                } else {
                    // No inventory entry yet – create one
                    await Inventory.create({
                        userId,
                        productId: existing._id,
                        quantity,
                        unit: existing.defaultUnit,
                        purchaseDate: new Date(),
                        status: 'active'
                    });
                    console.log(`🆕 Created new inventory entry for user ${userId}, product ${barcode}`);
                }
            }
            // Return existing product info (no new image verification needed)
            return NextResponse.json({
                success: true,
                message: 'Product already exists; inventory quantity updated',
                data: existing
            });
        }

        // Search for product images
        const searchQuery = `${name} ${brand || ''} ${flavor || ''}`.trim();
        console.log(`🔍 Searching for verified images: ${searchQuery}`);

        const imageUrls = await findProductImageUrls(searchQuery, 5);

        let finalImageUrl: string | null = null;
        let imageConfidence = 0;

        if (imageUrls.length > 0) {
            console.log(`🤖 Verifying ${imageUrls.length} images with AI...`);

            // Find and verify best image
            const { imageUrl, verification } = await findBestProductImage(
                imageUrls,
                { name, brand, category },
                90 // 90% confidence threshold
            );

            if (imageUrl && verification) {
                console.log(`✓ Best match: ${verification.confidence}% - ${verification.reasoning}`);

                // Download the verified image
                const savedPath = await downloadVerifiedImage(imageUrl);
                if (savedPath) {
                    finalImageUrl = savedPath;
                    imageConfidence = verification.confidence;
                }
            }
        }

        // Create product with verified image
        const product = await Product.create({
            barcode,
            name,
            brand: brand || '',
            category: category || 'Other',
            flavor: flavor || '',
            imageUrl: finalImageUrl,
            imageVerified: imageConfidence >= 90,
            imageConfidence,
            imageSource: finalImageUrl ? 'web' : null
        });

        return NextResponse.json({
            success: true,
            message: 'Product created with verified image',
            data: product,
            verification: {
                imageConfidence,
                imageVerified: imageConfidence >= 90
            }
        });

    } catch (error: any) {
        console.error('Product creation error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}

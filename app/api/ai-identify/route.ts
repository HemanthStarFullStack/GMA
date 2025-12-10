import { NextResponse } from 'next/server';
import { identifyProductFromImage } from '@/lib/gemini';
import connectDB from '@/lib/mongodb';

export async function POST(request: Request) {
    try {
        const { image } = await request.json();

        if (!image) {
            return NextResponse.json({ success: false, message: 'Image is required' }, { status: 400 });
        }

        if (!process.env.GEMINI_API_KEY) {
            throw new Error('Missing GEMINI_API_KEY environment variable');
        }

        console.log('🔎 Starting AI identification');
        const aiResult = await identifyProductFromImage(image);
        console.log('✅ AI identification completed', aiResult);

        // Fetch and verify product image from web
        console.log('🖼️ Fetching and verifying product images...');
        const { findProductImageUrls } = await import('@/lib/web-search');
        const { findBestProductImage } = await import('@/lib/verify-image');
        const fs = await import('fs');
        const path = await import('path');
        const https = await import('https');
        const crypto = await import('crypto');

        // Search for "Brand + Flavor + Product Name" for better accuracy
        const searchQuery = `${aiResult.brand} ${aiResult.flavor || ''} ${aiResult.name}`.trim();

        let imageUrl: string | null = null;
        let imageConfidence = 0;
        let imageVerified = false;

        // Get multiple image candidates
        const imageUrls = await findProductImageUrls(searchQuery, 5);

        if (imageUrls.length > 0) {
            console.log(`🤖 Verifying ${imageUrls.length} images with AI...`);

            // Find best match with AI verification
            const { imageUrl: verifiedUrl, verification } = await findBestProductImage(
                imageUrls,
                {
                    name: aiResult.name,
                    brand: aiResult.brand,
                    category: aiResult.category
                },
                90 // 90% confidence threshold
            );

            if (verifiedUrl && verification) {
                console.log(`✓ Best match: ${verification.confidence}% - ${verification.reasoning}`);
                imageConfidence = verification.confidence;
                imageVerified = verification.confidence >= 90;

                // Download the verified image
                const downloadVerifiedImage = (url: string): Promise<string | null> => {
                    return new Promise((resolve) => {
                        try {
                            const ext = path.extname(new URL(url).pathname) || '.jpg';
                            const filename = `img_${crypto.randomBytes(4).toString('hex')}${ext}`;
                            const relativePath = `/uploads/products/${filename}`;
                            const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

                            const dir = path.dirname(fullPath);
                            if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir, { recursive: true });
                            }

                            const file = fs.createWriteStream(fullPath);
                            const request = https.get(url, (response: any) => {
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
                            request.on('error', () => {
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
                };

                imageUrl = await downloadVerifiedImage(verifiedUrl);
            }
        }

        // Fallback: If verification failed, save the user uploaded/captured image
        if (!imageUrl) {
            console.log('⚠️ Image verification failed, using user image as fallback.');
            try {
                const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const filename = `user_${Date.now()}.jpg`;
                const relativePath = `/uploads/products/${filename}`;
                const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(fullPath, buffer);
                imageUrl = relativePath;
                imageVerified = false; // User image not verified
                console.log(`✅ Saved fallback user image: ${relativePath}`);
            } catch (err) {
                console.error("❌ Failed to save fallback image:", err);
            }
        }

        // Attempt DB connection, but continue even if it fails
        try {
            await connectDB();
            console.log('🔗 Connected to MongoDB');
        } catch (dbError) {
            console.error('⚠️ MongoDB connection failed, proceeding without DB:', dbError);
        }

        return NextResponse.json({
            success: true,
            data: {
                name: aiResult.name,
                brand: aiResult.brand,
                flavor: aiResult.flavor,
                category: aiResult.category,
                imageUrl: imageUrl,
                defaultUnit: aiResult.unit || 'units',
                estimated_quantity: aiResult.estimated_quantity ?? 1,
                averageDuration: 14,
                confidence: 0.9,
                imageVerified,
                imageConfidence,
                imageSource: imageVerified ? 'web' : 'ai'
            },
        });
    } catch (error: any) {
        console.error('Route Error:', error);
        return NextResponse.json(
            {
                success: false,
                message: 'Internal Server Error',
                error: error.message,
            },
            { status: 500 }
        );
    }
}

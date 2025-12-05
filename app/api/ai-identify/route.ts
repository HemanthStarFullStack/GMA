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

        // Fetch product image from web
        console.log('🖼️ Fetching product image...');
        const { findAndDownloadProductImage } = await import('@/lib/web-search');
        const fs = await import('fs');
        const path = await import('path');

        // Search for "Brand + Flavor + Product Name" for better accuracy
        const searchQuery = `${aiResult.brand} ${aiResult.flavor || ''} ${aiResult.name}`.trim();
        let imageUrl = await findAndDownloadProductImage(searchQuery);

        // Fallback: If web search failed, save the user uploaded/captured image
        if (!imageUrl) {
            console.log('⚠️ Web image search failed, using user image as fallback.');
            try {
                // Remove header if present (data:image/jpeg;base64,)
                const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                const filename = `user_${Date.now()}.jpg`;
                const relativePath = `/uploads/products/${filename}`;
                const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

                // Ensure directory exists
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(fullPath, buffer);
                imageUrl = relativePath;
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

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

interface VerificationResult {
    matches: boolean;
    confidence: number;
    reasoning: string;
}

/**
 * Verify if an image matches the given product details using Gemini Vision
 * @param imageUrl URL of the image to verify
 * @param productDetails Product information to match against
 * @returns Verification result with confidence score
 */
export async function verifyProductImage(
    imageUrl: string,
    productDetails: { name: string; brand?: string; category?: string }
): Promise<VerificationResult> {
    try {
        // Fetch image as base64
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }

        const imageBuffer = await response.arrayBuffer();
        const base64Image = Buffer.from(imageBuffer).toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';

        // Initialize Gemini model
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        const prompt = `You are a product image verification AI.

Product Details:
- Name: ${productDetails.name}
- Brand: ${productDetails.brand || 'Unknown'}
- Category: ${productDetails.category || 'Unknown'}

Analyze this image and determine if it accurately shows the specified product.

Consider:
1. Does the image show the exact product name and brand?
2. Is the product packaging/appearance consistent with the description?
3. Are there any misleading or unrelated elements?

Return ONLY valid JSON with this exact structure (no markdown):
{
  "matches": true or false,
  "confidence": 0-100 (integer),
  "reasoning": "brief explanation"
}`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType,
                    data: base64Image
                }
            }
        ]);

        const text = result.response.text().trim();

        // Remove markdown code blocks if present
        const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const verification: VerificationResult = JSON.parse(jsonText);

        return verification;
    } catch (error) {
        console.error('Image verification error:', error);
        return {
            matches: false,
            confidence: 0,
            reasoning: `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}

/**
 * Verify multiple images and return the best match
 * @param imageUrls Array of image URLs to verify
 * @param productDetails Product information to match against
 * @param minConfidence Minimum confidence threshold (default: 90)
 * @returns Best matching image URL and verification result
 */
export async function findBestProductImage(
    imageUrls: string[],
    productDetails: { name: string; brand?: string; category?: string },
    minConfidence: number = 90
): Promise<{ imageUrl: string | null; verification: VerificationResult | null }> {
    if (imageUrls.length === 0) {
        return { imageUrl: null, verification: null };
    }

    // Verify all images in parallel
    const verifications = await Promise.all(
        imageUrls.map(async (url) => ({
            url,
            result: await verifyProductImage(url, productDetails)
        }))
    );

    // Sort by confidence (highest first)
    verifications.sort((a, b) => b.result.confidence - a.result.confidence);

    const best = verifications[0];

    // If best match meets minimum confidence, return it
    if (best.result.confidence >= minConfidence) {
        console.log(`✓ Found verified image with ${best.result.confidence}% confidence`);
        return { imageUrl: best.url, verification: best.result };
    }

    // Otherwise, return the best we have (even if below threshold)
    console.log(`⚠ Best image only ${best.result.confidence}% confident (threshold: ${minConfidence}%)`);
    return { imageUrl: best.url, verification: best.result };
}

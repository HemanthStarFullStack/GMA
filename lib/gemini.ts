import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Available models (Feb 2026) - from https://ai.google.dev/gemini-api/docs/models
const MODELS_TO_TRY = [
    "gemini-2.5-flash",           // Stable - best price-performance
    "gemini-3-flash-preview",     // Preview - newest
    "gemini-2.5-flash-preview-09-2025"  // Preview fallback
];

// Helper to generate content with timeout
async function generateWithTimeout(model: any, contents: any[], timeoutMs: number = 20000) {
    const resultPromise = model.generateContent(contents);
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([resultPromise, timeoutPromise]);
}

export async function identifyProductFromImage(base64Image: string) {
    if (!genAI) {
        throw new Error("Gemini API Key is missing. Please configure GEMINI_API_KEY in .env.local");
    }

    // Remove the data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

    // Detect MIME type from base64 prefix if available
    let mimeType = "image/jpeg";
    if (base64Image.startsWith("data:image/png")) {
        mimeType = "image/png";
    } else if (base64Image.startsWith("data:image/webp")) {
        mimeType = "image/webp";
    } else if (base64Image.startsWith("data:image/gif")) {
        mimeType = "image/gif";
    }

    const prompt = `You are an expert grocery product identifier. Look at this image and identify the product.

TASK: Identify this grocery/food/household product from the image.

IMPORTANT RULES:
1. If you can see ANY product (food, drink, snack, household item), identify it
2. Even if the image is blurry or partial, make your best guess
3. Use visible text, logos, colors, and packaging to identify
4. If brand is not visible, guess based on packaging style or say "Generic"
5. NEVER return an error if you can see ANY product

RESPOND IN THIS EXACT JSON FORMAT:
{
  "name": "Product Name (be specific, e.g. 'Doritos Nacho Cheese Chips')",
  "brand": "Brand Name (e.g. 'Doritos', 'Nestle', 'Generic')",
  "flavor": "Flavor/Variant if applicable (e.g. 'Nacho Cheese', 'Vanilla', '')",
  "category": "Category (Dairy & Eggs | Beverages | Fruits & Vegetables | Meat & Seafood | Bakery | Pantry | Frozen Foods | Snacks | Condiments & Sauces | Cleaning & Household | Personal Care | Other)",
  "estimated_quantity": 1,
  "unit": "units"
}

ONLY return the JSON object, no other text.`;

    const imagePart = {
        inlineData: {
            data: base64Data,
            mimeType: mimeType,
        },
    };

    let lastError: Error | null = null;
    let text = "";

    // Try each model in order
    for (const modelName of MODELS_TO_TRY) {
        try {
            console.log(`🤖 Trying model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });
            const result: any = await generateWithTimeout(model, [prompt, imagePart], 25000);
            const response = await result.response;
            text = response.text();

            if (text && text.trim()) {
                console.log(`✅ Success with model: ${modelName}`);
                break;
            }
        } catch (error: any) {
            console.error(`❌ Model ${modelName} failed:`);
            console.error(`   Message: ${error.message}`);
            if (error.errorDetails) console.error(`   Details:`, JSON.stringify(error.errorDetails));
            lastError = error;
            // Continue to next model
        }
    }

    if (!text || !text.trim()) {
        throw new Error(lastError?.message || "All AI models failed to respond");
    }

    console.log("📝 AI Response:", text.substring(0, 200) + "...");

    // Parse JSON from response
    let jsonString = text.trim();

    // Remove markdown code blocks if present
    jsonString = jsonString.replace(/```json\s*/gi, "").replace(/```\s*/gi, "");

    // Extract JSON object
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        jsonString = jsonMatch[0];
    }

    try {
        const parsedResult = JSON.parse(jsonString);

        // Check for explicit error from AI
        if (parsedResult.error) {
            throw new Error(parsedResult.error);
        }

        // Validate required fields with fallbacks
        const result = {
            name: parsedResult.name || "Unknown Product",
            brand: parsedResult.brand || "Generic",
            flavor: parsedResult.flavor || "",
            category: parsedResult.category || "Other",
            estimated_quantity: parsedResult.estimated_quantity || 1,
            unit: parsedResult.unit || "units",
            confidence: 0.85 // AI-identified confidence
        };

        // Ensure name is not empty
        if (!result.name || result.name === "Unknown Product") {
            throw new Error("Could not identify product name from image");
        }

        console.log("✅ Parsed product:", result);
        return result;

    } catch (parseError: any) {
        console.error("❌ JSON Parse Error:", parseError.message);
        console.error("Raw text was:", text);

        // Try to extract basic info from text if JSON fails
        const nameMatch = text.match(/name['":\s]+([^"'\n,}]+)/i);
        if (nameMatch) {
            return {
                name: nameMatch[1].trim(),
                brand: "Unknown",
                flavor: "",
                category: "Other",
                estimated_quantity: 1,
                unit: "units",
                confidence: 0.5
            };
        }

        throw new Error("AI could not identify the product. Please try a clearer image.");
    }
}

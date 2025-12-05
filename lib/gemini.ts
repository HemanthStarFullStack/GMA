import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Helper to generate content with timeout
async function generateWithTimeout(model: any, prompt: string, imagePart: any, timeoutMs: number = 15000) {
    const resultPromise = model.generateContent([prompt, imagePart]);
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
    );
    return Promise.race([resultPromise, timeoutPromise]);
}

export async function identifyProductFromImage(base64Image: string) {
    if (!genAI) {
        throw new Error("Gemini API Key is missing");
    }

    // Remove the data URL prefix if present
    const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const prompt = `You are an expert grocery product identifier. Analyze this image and identify the grocery product with high accuracy.

INSTRUCTIONS:
1. Carefully examine the product packaging, labels, and any visible text
2. Identify the specific product name (e.g., "Doritos Nacho Cheese", "Whole Milk")
3. Extract the BRAND name if visible (e.g., "Lay's", "Coca-Cola")
4. Extract the FLAVOR or VARIANT if applicable (e.g., "Cream & Onion", "Vanilla", "Spicy")
5. Determine the appropriate grocery category
6. Estimate the quantity based on packing size
7. Specify the unit

CATEGORIES:
- Dairy & Eggs
- Beverages
- Fruits & Vegetables
- Meat & Seafood
- Bakery
- Pantry
- Frozen Foods
- Condiments & Sauces
- Cleaning & Household
- Personal Care

RESPONSE FORMAT (strict JSON only):
{
  "name": "specific product name",
  "brand": "brand name or 'Unknown'",
  "flavor": "flavor/variant or '' if none",
  "category": "one of the categories above",
  "estimated_quantity": <number>,
  "unit": "appropriate unit"
}

IMPORTANT:
- Return ONLY valid JSON, no markdown formatting.
- Be specific and accurate.
- If unsure, return {"error": "Unable to identify product"}`;

    const imagePart = {
        inlineData: {
            data: base64Data,
            mimeType: "image/jpeg",
        },
    };

    let text = "";

    try {
        console.log("🚀 Attempting identification with gemini-3-pro-preview...");
        const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });
        const result: any = await generateWithTimeout(model, prompt, imagePart, 20000); // 20s timeout for Pro
        const response = await result.response;
        text = response.text();
    } catch (error: any) {
        console.warn(`⚠️ gemini-3-pro-preview failed: ${error.message}. Falling back to gemini-2.0-flash-exp...`);
        try {
            const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
            const result: any = await generateWithTimeout(fallbackModel, prompt, imagePart, 15000); // 15s timeout for Flash
            const response = await result.response;
            text = response.text();
        } catch (fallbackError: any) {
            console.error("❌ Fallback model also failed:", fallbackError.message);
            throw new Error(`AI identification failed: ${fallbackError.message}`);
        }
    }

    console.log("Gemini raw response:", text);

    if (!text || !text.trim()) {
        throw new Error("Received empty response from AI");
    }

    // Try multiple parsing strategies
    let jsonString = text.trim();
    // Remove markdown code blocks
    jsonString = jsonString.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    // Extract JSON object if wrapped
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        jsonString = jsonMatch[0];
    }

    try {
        const parsedResult = JSON.parse(jsonString);

        if (parsedResult.error) {
            throw new Error(parsedResult.error);
        }

        if (!parsedResult.name || !parsedResult.category) {
            throw new Error("Invalid response: missing required fields");
        }

        // Ensure flavor is present
        return {
            ...parsedResult,
            flavor: parsedResult.flavor || ''
        };
    } catch (parseError: any) {
        console.error("JSON Parse Error:", parseError, "Raw Text:", text);
        throw new Error("Failed to parse AI response. Unexpected format.");
    }
}

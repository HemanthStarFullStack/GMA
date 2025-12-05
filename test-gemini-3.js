const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// API Key from .env.local
const API_KEY = "AIzaSyDnez21roY1FtgN-E3gMYkCpQyt5AUAhs4";

// Image path
const IMAGE_PATH = "C:/Users/91834/Desktop/New folder/sinti-v2/real_cereal.jpg";

async function testModel(modelName) {
    console.log(`\n🤖 Testing Model: ${modelName}...`);
    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: modelName });

        const imageBuffer = fs.readFileSync(IMAGE_PATH);
        const base64Image = imageBuffer.toString('base64');
        const prompt = "Identify this product and tell me its brand and name.";

        const imagePart = {
            inlineData: {
                data: base64Image,
                mimeType: "image/png"
            }
        };

        console.log(`🔧 Calling generateContent on model: ${modelName}`);
        const timeoutMs = 15000;
        const resultPromise = model.generateContent([prompt, imagePart]);
        const result = await Promise.race([
            resultPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini request timed out')), timeoutMs))
        ]);
        const response = await result.response;
        const text = response.text();

        console.log(`✅ SUCCESS with ${modelName}!`);
        console.log("📝 Response:", text.substring(0, 100) + "...");
        return true;
    } catch (error) {
        console.log(`❌ FAILED with ${modelName}`);
        console.error("Full error:", error);
        // If preview fails, fallback to stable model
        if (modelName === "gemini-3-pro-preview") {
            console.log("🔄 Retrying with fallback model gemini-2.0-flash-exp...");
            return await testModel("gemini-2.0-flash-exp");
        }
        return false;
    }
}

async function runTests() {
    console.log("🚀 Starting Gemini API Tests (Dec 2025 Models)");
    console.log("---------------------------------------------");

    // Test Gemini 3.0 Pro (Flagship)
    await testModel("gemini-2.0-flash-exp");
}

runTests();

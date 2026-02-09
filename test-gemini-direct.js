// Test with correct model names from official docs
const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = "AIzaSyAsLi8h5rioQvvlt0BVpUMwiy3ElQUnX6k";
console.log("🔑 API Key:", apiKey.substring(0, 15) + "...");

const genAI = new GoogleGenerativeAI(apiKey);

// Correct model names from https://ai.google.dev/gemini-api/docs/models
const modelsToTest = [
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash-preview-09-2025"
];

async function testModel(modelName) {
    console.log(`\n🧪 Testing: ${modelName}`);
    try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, say hi back in 3 words");
        const text = (await result.response).text();
        console.log(`   ✅ SUCCESS: "${text.trim()}"`);
        return true;
    } catch (error) {
        console.log(`   ❌ FAILED: ${error.message.substring(0, 100)}`);
        return false;
    }
}

async function main() {
    console.log("\n=== Testing Correct Model Names ===\n");
    let working = [];
    for (const model of modelsToTest) {
        if (await testModel(model)) {
            working.push(model);
        }
    }
    console.log("\n=== RESULTS ===");
    console.log("Working models:", working.length > 0 ? working : "NONE");
}

main();

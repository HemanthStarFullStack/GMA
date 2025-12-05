const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = "AIzaSyDnez21roY1FtgN-E3gMYkCpQyt5AUAhs4";

async function test() {
    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent("Hello");
        console.log("✅ API Key is VALID! Response:", result.response.text());
    } catch (error) {
        console.log("❌ API Key is INVALID. Error:", error.message);
    }
}

test();

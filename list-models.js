const https = require('https');

const API_KEY = "AIzaSyDnez21roY1FtgN-E3gMYkCpQyt5AUAhs4";
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

console.log(`Fetching models from: ${url.replace(API_KEY, 'HIDDEN_KEY')}`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error("❌ API Error:", JSON.stringify(json.error, null, 2));
            } else if (json.models) {
                console.log("✅ Available Models:");
                const models = json.models.map(m => ({
                    name: m.name.replace('models/', ''),
                    version: m.version,
                    displayName: m.displayName
                }));

                // Filter for Gemini models
                const geminiModels = models.filter(m => m.name.includes('gemini'));

                console.table(geminiModels);

                // Find latest
                console.log("\n🔍 Analysis:");
                const latest = geminiModels.find(m => m.name.includes('gemini-3.0-pro')) ||
                    geminiModels.find(m => m.name.includes('gemini-2.0-flash-exp')) ||
                    geminiModels.find(m => m.name.includes('gemini-1.5-pro-latest')) ||
                    geminiModels.find(m => m.name.includes('gemini-1.5-flash'));

                if (latest) {
                    console.log(`🎯 Recommended Model: ${latest.name}`);
                } else {
                    console.log("⚠️ No standard Gemini models found.");
                }
            } else {
                console.log("⚠️ Unexpected response format:", data);
            }
        } catch (e) {
            console.error("❌ Parse Error:", e.message);
            console.log("Raw Data:", data);
        }
    });

}).on("error", (err) => {
    console.error("❌ Network Error:", err.message);
});

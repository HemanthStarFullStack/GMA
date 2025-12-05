const http = require('http');
const fs = require('fs');

async function testE2E() {
    console.log("🚀 Starting End-to-End API Test (Image -> Gemini -> API -> DB)");
    console.log("-------------------------------------------------------------");

    const IMAGE_PATH = "C:/Users/91834/Desktop/New folder/sinti-v2/real_cereal.jpg";

    if (!fs.existsSync(IMAGE_PATH)) {
        console.error(`❌ Error: Image file not found at ${IMAGE_PATH}`);
        return;
    }

    console.log(`📸 Reading image from ${IMAGE_PATH}...`);
    const imageBuffer = fs.readFileSync(IMAGE_PATH);
    const base64Image = imageBuffer.toString('base64');
    const postData = JSON.stringify({ image: base64Image });

    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/ai-identify',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    console.log(`🔄 Sending request to http://localhost:3001/api/ai-identify...`);
    const startTime = Date.now();

    const req = http.request(options, (res) => {
        console.log(`📡 Status Code: ${res.statusCode}`);
        console.log(`📡 Headers: ${JSON.stringify(res.headers)}`);

        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            const endTime = Date.now();
            console.log(`⏱️ Request took ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

            try {
                const json = JSON.parse(data);
                console.log("\n📦 Response Data:");
                console.log(JSON.stringify(json, null, 2));

                if (res.statusCode === 200 && json.success) {
                    console.log("\n✅ SUCCESS: API verified!");
                    if (json.data) {
                        console.log("   - Product: " + json.data.name);
                        console.log("   - Confidence: " + json.data.confidence);
                    }
                } else {
                    console.log("\n❌ FAILED: API returned error");
                }
            } catch (e) {
                console.error("❌ Failed to parse JSON response:", data);
            }
        });
    });

    req.on('error', (e) => {
        console.error(`❌ Problem with request: ${e.message}`);
    });

    // Write data to request body
    req.write(postData);
    req.end();
}

testE2E();

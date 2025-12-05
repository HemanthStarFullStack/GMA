const fs = require('fs');

async function testAI(imagePath, productName) {
    try {
        console.log(`\n========== Testing: ${productName} ==========`);

        // Read image and convert to base64
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

        // Call the API
        const response = await fetch('http://localhost:3001/api/ai-identify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: base64Image })
        });

        const result = await response.json();

        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(result, null, 2));

        if (result.success && result.data) {
            console.log('\n✅ AI Identified:');
            console.log(`   Name: ${result.data.name}`);
            console.log(`   Brand: ${result.data.brand}`);
            console.log(`   Category: ${result.data.category}`);
            console.log(`   Unit: ${result.data.defaultUnit}`);
            console.log(`   Confidence: ${result.data.confidence}`);
        } else {
            console.log('\n❌ Failed:', result.message);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function runTests() {
    // Test with real images in current directory
    await testAI('real_cereal.jpg', 'Cereal Box');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between requests

    await testAI('real_milk.jpg', 'Milk Product');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await testAI('real_snack.jpg', 'Snack Product');
}

runTests().catch(console.error);

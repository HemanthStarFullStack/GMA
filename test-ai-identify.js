const fs = require('fs');
const https = require('https');

const imagePath = './public/uploads/products/user_1765199343443.jpg';
const imageBuffer = fs.readFileSync(imagePath);
const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

const data = JSON.stringify({ image: base64Image });

const options = {
    hostname: '192.168.1.34.nip.io',
    port: 3001,
    path: '/api/ai-identify',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    },
    rejectUnauthorized: false // Skip certificate verification for self-signed cert
};

console.log('🚀 Sending image to AI identify API...');
console.log(`📦 Image size: ${(data.length / 1024).toFixed(2)} KB`);

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`\n📬 Response Status: ${res.statusCode}`);
        console.log('📝 Response Body:');
        try {
            const json = JSON.parse(body);
            console.log(JSON.stringify(json, null, 2));
        } catch {
            console.log(body);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Request Error:', error.message);
});

req.write(data);
req.end();

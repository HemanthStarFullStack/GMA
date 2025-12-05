const google = require('googlethis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

async function downloadImage(url, destDir) {
    if (!isValidUrl(url)) return null;

    return new Promise((resolve) => {
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const filename = `img_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const relativePath = `/uploads/products/${filename}`;
        const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(fullPath);

        const request = https.get(url, (response) => {
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(fullPath, () => { });
                resolve(null);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(relativePath);
            });
        });

        request.on('error', (err) => {
            file.close();
            fs.unlink(fullPath, () => { });
            resolve(null);
        });

        request.setTimeout(10000, () => {
            request.destroy();
            file.close();
            fs.unlink(fullPath, () => { });
            resolve(null);
        });
    });
}

async function findAndDownloadProductImage(query) {
    try {
        console.log(`🔍 Searching web for image: "${query}"`);
        const results = await google.image(query + " product packaging", { safe: true });

        if (!results || results.length === 0) {
            console.log("❌ No images found for query.");
            return null;
        }

        for (let i = 0; i < Math.min(results.length, 3); i++) {
            const result = results[i];
            const imageUrl = result.url;

            if (imageUrl) {
                console.log(`⬇️ Downloading candidate ${i + 1}: ${imageUrl}`);
                const savedPath = await downloadImage(imageUrl, 'products');
                if (savedPath) {
                    console.log(`✅ Image saved to: ${savedPath}`);
                    return savedPath;
                }
            }
        }
        console.log("❌ Failed to download any valid images.");
        return null;
    } catch (error) {
        console.error("⚠️ Web image search failed:", error);
        return null;
    }
}

// Run test
findAndDownloadProductImage("Lay's Classic Potato Chips");

import google from 'googlethis';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

/**
 * Validates if the given string is a valid URL
 */
function isValidUrl(string: string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Downloads an image from a URL and saves it to the local filesystem
 */
async function downloadImage(url: string, destDir: string): Promise<string | null> {
    if (!isValidUrl(url)) return null;

    return new Promise((resolve) => {
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        // Generate a simplified filename
        const filename = `img_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const relativePath = `/uploads/products/${filename}`;
        const fullPath = path.join(process.cwd(), 'public', 'uploads', 'products', filename);

        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(fullPath);

        const request = https.get(url, (response) => {
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(fullPath, () => { }); // Delete failed file
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
            fs.unlink(fullPath, () => { }); // Delete failed file
            resolve(null);
        });

        // Timeout
        request.setTimeout(10000, () => {
            request.destroy();
            file.close();
            fs.unlink(fullPath, () => { });
            resolve(null);
        });
    });
}

/**
 * Searches for a product image on the web and downloads the best match
 */
export async function findAndDownloadProductImage(query: string): Promise<string | null> {
    try {
        console.log(`🔍 Searching web for image: "${query}"`);

        // Results is an array of objects
        const results = await google.image(query + " product packaging", { safe: true });

        if (!results || results.length === 0) {
            console.log("❌ No images found for query.");
            return null;
        }

        // Try to download the first few images
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

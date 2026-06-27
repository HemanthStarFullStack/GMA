// Browser-only: downscale an image blob/file to a light JPEG before upload.
// Stored product photos and avatars are only ever shown as small thumbnails
// (≤80px cards, ~200px previews), so uploading the full-res capture wasted
// bandwidth and made photos load slowly. ~600px @ q0.78 is sharp at those sizes
// and ~10–20× smaller. If the image can't be decoded (e.g. HEIC in some
// browsers) or canvas fails, the original is returned so upload still works.
export async function toThumb(input: Blob, maxEdge = 600, quality = 0.78): Promise<Blob> {
    let bmp: ImageBitmap;
    try {
        bmp = await createImageBitmap(input);
    } catch {
        return input;
    }
    try {
        const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
        const out = await new Promise<Blob | null>((r) => c.toBlob((b) => r(b), "image/jpeg", quality));
        return out ?? input;
    } finally {
        bmp.close();
    }
}

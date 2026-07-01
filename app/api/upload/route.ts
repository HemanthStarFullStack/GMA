import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

// Files land in public/uploads, which is a persistent Docker volume in prod.
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Extension is decided by the file's actual bytes, not the client-supplied
// Content-Type — a spoofed multipart part could otherwise get arbitrary
// content saved to disk under a trusted-looking image extension.
function sniffImageExt(buf: Buffer): string | null {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('ascii'))) return 'gif';
    return null;
}

/**
 * Accepts a single image file (multipart form field "file") and returns a
 * public URL under /uploads. Used by the scan/confirm form to replace an
 * inaccurate product photo.
 */
export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file');
        if (!(file instanceof File)) {
            return NextResponse.json({ success: false, message: 'No file provided' }, { status: 400 });
        }

        if (file.size > MAX_BYTES) {
            return NextResponse.json({ success: false, message: 'Image too large (max 5 MB)' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const ext = sniffImageExt(buffer);
        if (!ext) {
            return NextResponse.json({ success: false, message: 'Unsupported image type' }, { status: 415 });
        }

        await mkdir(UPLOAD_DIR, { recursive: true });
        const filename = `${randomUUID()}.${ext}`;
        await writeFile(path.join(UPLOAD_DIR, filename), buffer);

        return NextResponse.json({ success: true, url: `/uploads/${filename}` });
    } catch (error: any) {
        return serverError('upload', error, 'Upload failed');
    }
}

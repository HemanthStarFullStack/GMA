import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';

// Files land in public/uploads, which is a persistent Docker volume in prod.
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

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

        const ext = ALLOWED[file.type];
        if (!ext) {
            return NextResponse.json({ success: false, message: 'Unsupported image type' }, { status: 415 });
        }
        if (file.size > MAX_BYTES) {
            return NextResponse.json({ success: false, message: 'Image too large (max 5 MB)' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        await mkdir(UPLOAD_DIR, { recursive: true });
        const filename = `${randomUUID()}.${ext}`;
        await writeFile(path.join(UPLOAD_DIR, filename), buffer);

        return NextResponse.json({ success: true, url: `/uploads/${filename}` });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Upload failed', error: error.message },
            { status: 500 },
        );
    }
}

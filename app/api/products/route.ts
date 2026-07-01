import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import connectDB from '@/lib/mongodb';
import { UserProduct } from '@/lib/models';
import { resolveProduct } from '@/lib/userProduct';
import { serverError } from '@/lib/apiError';

export const dynamic = 'force-dynamic';

/**
 * Suggestion lookup for the scan confirm form. Given a product id (barcode /
 * OCR-slug / MANUAL-slug), returns the caller's OWN saved version if they have
 * one, else the shared catalogue suggestion, else null. Read-only and scoped to
 * the session user — never exposes another account's data.
 */
export async function GET(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }
        const id = (new URL(request.url).searchParams.get('id') || '').trim();
        if (!id) return NextResponse.json({ success: false, message: 'id is required' }, { status: 400 });

        await connectDB();
        const eff = await resolveProduct(session.user.id, id);
        if (!eff) return NextResponse.json({ success: true, data: null, from: null });

        const mine = await UserProduct.findOne({ userId: session.user.id, productId: id }).select('_id').lean();
        return NextResponse.json({ success: true, data: eff, from: mine ? 'user' : 'shared' });
    } catch (error: any) {
        return serverError('products', error, 'Lookup failed');
    }
}

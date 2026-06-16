import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/auth';
import { predictProductMeta } from '@/lib/gemini';
import connectDB from '@/lib/mongodb';
import { User } from '@/lib/models';

/**
 * On-demand prediction for the scan/confirm form. The user can correct the
 * size, flavor, price and category, then ask for a fresh duration estimate that
 * uses ALL of that context — more signal than the lookup-time guess had.
 */
export async function POST(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json().catch(() => ({}));
        const name = (body.name || '').toString().trim();
        if (!name) {
            return NextResponse.json({ success: false, message: 'Product name is required' }, { status: 400 });
        }

        // Household size is part of the context — a unit lasts a big family far
        // less time than one person. Pull it from the user's saved settings.
        // (The dev test user has a non-ObjectId id and no DB record — default to 1.)
        let householdSize = 1;
        if (mongoose.Types.ObjectId.isValid(session.user.id)) {
            await connectDB();
            const user = await User.findById(session.user.id).select('familySize').lean() as { familySize?: number } | null;
            householdSize = Math.max(1, user?.familySize || 1);
        }

        const meta = await predictProductMeta(
            name,
            (body.brand || '').toString().trim(),
            (body.category || 'Other').toString(),
            (body.unit || body.size || 'units').toString().trim(),
            {
                flavor: (body.flavor || '').toString().trim() || undefined,
                price: body.price !== undefined && body.price !== '' ? body.price : undefined,
                size: (body.size || '').toString().trim() || undefined,
                householdSize,
            },
        );

        return NextResponse.json({ success: true, data: meta });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, message: 'Prediction failed', error: error.message },
            { status: 500 },
        );
    }
}

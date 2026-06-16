import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import { User } from '@/lib/models';
import { auth } from '@/auth';

/**
 * User profile / household settings. Reads and writes the same `users` document
 * created by the NextAuth MongoDB adapter (familySize, survey preference, demo flag).
 */

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        // The dev test user has a non-ObjectId id and no DB record — serve defaults.
        if (!mongoose.Types.ObjectId.isValid(session.user.id)) {
            return NextResponse.json({
                success: true,
                data: { name: session.user.name || 'User', familySize: 1, surveyFrequency: 'occasional', demoSeeded: true, tourCompleted: true },
            });
        }

        await connectDB();
        const user = await User.findById(session.user.id).lean();

        return NextResponse.json({
            success: true,
            data: {
                name: session.user.name || user?.displayName || 'User',
                familySize: user?.familySize ?? 1,
                surveyFrequency: user?.preferences?.surveyFrequency ?? 'occasional',
                demoSeeded: user?.demoSeeded ?? false,
                tourCompleted: user?.tourCompleted ?? false,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        // Test user isn't persisted — accept the change as a no-op so the UI works.
        if (!mongoose.Types.ObjectId.isValid(session.user.id)) {
            const body = await request.json().catch(() => ({}));
            return NextResponse.json({
                success: true,
                data: { familySize: body.familySize ?? 1, surveyFrequency: body.surveyFrequency ?? 'occasional' },
            });
        }

        await connectDB();
        const body = await request.json();

        const update: Record<string, any> = {};
        if (typeof body.familySize === 'number') {
            update.familySize = Math.max(1, Math.min(20, Math.round(body.familySize)));
        }
        if (body.surveyFrequency === 'always' || body.surveyFrequency === 'occasional') {
            update['preferences.surveyFrequency'] = body.surveyFrequency;
        }
        if (typeof body.tourCompleted === 'boolean') {
            update.tourCompleted = body.tourCompleted;
        }

        const user = await User.findByIdAndUpdate(session.user.id, { $set: update }, { new: true }).lean();

        return NextResponse.json({
            success: true,
            data: {
                familySize: user?.familySize ?? 1,
                surveyFrequency: user?.preferences?.surveyFrequency ?? 'occasional',
            },
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

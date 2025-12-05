import { NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { User } from '@/lib/models';

export async function GET() {
    try {
        // Connect to MongoDB
        await connectDB();

        // Try to count users (will be 0 on first run)
        const userCount = await User.countDocuments();

        // Create a test user if none exist
        if (userCount === 0) {
            const testUser = await User.create({
                email: 'demo@sinti.com',
                displayName: 'Demo User',
                familySize: 4,
                preferences: {
                    surveyFrequency: 'occasional'
                }
            });

            return NextResponse.json({
                success: true,
                message: 'MongoDB connected! Created test user.',
                data: {
                    userCount: 1,
                    testUser: {
                        email: testUser.email,
                        displayName: testUser.displayName,
                        familySize: testUser.familySize
                    }
                }
            });
        }

        return NextResponse.json({
            success: true,
            message: 'MongoDB connected successfully!',
            data: {
                userCount
            }
        });
    } catch (error: any) {
        console.error('MongoDB connection error:', error);
        return NextResponse.json({
            success: false,
            message: 'MongoDB connection failed',
            error: error.message
        }, { status: 500 });
    }
}

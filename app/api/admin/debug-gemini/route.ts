import { NextResponse } from 'next/server';
import { predictConsumptionDays } from '@/lib/gemini';

export async function GET() {
    const keySet = !!process.env.GEMINI_API_KEY;
    const keyPrefix = process.env.GEMINI_API_KEY?.slice(0, 8) ?? 'not set';
    const days = await predictConsumptionDays("Lays Classic Salted Chips", "Lays", "Snacks", "26g packet");
    return NextResponse.json({ keySet, keyPrefix, predictedDays: days });
}

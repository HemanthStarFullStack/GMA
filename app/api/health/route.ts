import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';

// Liveness/readiness probe. Returns 200 only when the DB is reachable so
// orchestrators (Docker healthcheck, k8s, load balancers) can gate traffic.
export const dynamic = 'force-dynamic';

export async function GET() {
    const started = Date.now();
    try {
        await connectDB();
        const state = mongoose.connection.readyState; // 1 = connected
        const ok = state === 1;
        return NextResponse.json(
            {
                status: ok ? 'ok' : 'degraded',
                db: ok ? 'connected' : 'disconnected',
                uptime: Math.round(process.uptime()),
                ms: Date.now() - started,
            },
            { status: ok ? 200 : 503 },
        );
    } catch {
        return NextResponse.json({ status: 'error', db: 'unreachable' }, { status: 503 });
    }
}

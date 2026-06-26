import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';

// Liveness/readiness probe. Returns 200 only when the DB is reachable so
// orchestrators (Docker healthcheck, k8s, load balancers) can gate traffic.
export const dynamic = 'force-dynamic';

// Probe the scan-pipeline models. Cheap calls (list/health, no generation) so
// it costs no quota. NEVER gates the 200 — a model blip must not restart the
// container; it only reports so a dead key (the bug that hid for days) is visible
// at /api/health?deep=1.
async function probeModels() {
    const groqKey = process.env.GROQ_API_KEY || '';
    const vlmUrl = process.env.VISION_OCR_URL || '';
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const ping = async (p: Promise<Response>) => {
        try { return (await p).status; } catch { return 0; }
    };
    const [groq, vlm, gemini] = await Promise.all([
        groqKey
            ? ping(fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${groqKey}` }, signal: AbortSignal.timeout(4000) }))
            : Promise.resolve(-1),
        vlmUrl
            ? ping(fetch(`${vlmUrl}/health`, { signal: AbortSignal.timeout(2000) }))
            : Promise.resolve(-1),
        geminiKey
            ? ping(fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, { signal: AbortSignal.timeout(4000) }))
            : Promise.resolve(-1),
    ]);
    const label = (code: number) => (code === -1 ? 'not_configured' : code === 200 ? 'ok' : code === 0 ? 'unreachable' : `http_${code}`);
    return {
        groq: { status: label(groq), model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b' },
        vlm: { status: label(vlm) },
        gemini: { status: label(gemini) },
    };
}

export async function GET(request: Request) {
    const started = Date.now();
    const deep = new URL(request.url).searchParams.get('deep') === '1';
    try {
        await connectDB();
        const state = mongoose.connection.readyState; // 1 = connected
        const ok = state === 1;
        const models = deep ? await probeModels() : undefined;
        return NextResponse.json(
            {
                status: ok ? 'ok' : 'degraded',
                db: ok ? 'connected' : 'disconnected',
                ...(models ? { models } : {}),
                uptime: Math.round(process.uptime()),
                ms: Date.now() - started,
            },
            { status: ok ? 200 : 503 },
        );
    } catch {
        return NextResponse.json({ status: 'error', db: 'unreachable' }, { status: 503 });
    }
}

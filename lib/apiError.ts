import { NextResponse } from 'next/server';

/**
 * Standard 500 response. Logs the real error server-side (so detail isn't lost)
 * and returns a generic message to the client — never leak internal error text,
 * stack traces, or driver internals to callers.
 */
export function serverError(scope: string, error: unknown, message = 'Something went wrong', status = 500) {
    console.error(`[${scope}]`, error);
    return NextResponse.json({ success: false, message }, { status });
}

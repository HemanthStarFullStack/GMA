import { NextResponse } from 'next/server';

/**
 * Guard for destructive / diagnostic admin endpoints.
 *
 * Returns a NextResponse to short-circuit the request when access is denied,
 * or `null` when the caller is authorised.
 *
 * Access requires the `x-admin-secret` request header to match the
 * `ADMIN_SECRET` env var. If `ADMIN_SECRET` is not set, these endpoints are
 * disabled entirely (404) — so a production deploy that forgets to set it can
 * never expose a DB-wiping route.
 */
export function requireAdmin(request: Request): NextResponse | null {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
        return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }
    const provided = request.headers.get('x-admin-secret');
    if (provided !== secret) {
        return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    return null;
}

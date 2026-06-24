import { NextResponse } from 'next/server';
import { buildForecasts } from '@/lib/forecast';
import { auth } from '@/auth';
import { serverError } from '@/lib/apiError';

/**
 * Consumption analytics + run-out predictions.
 *
 * The per-product forecasting lives in lib/forecast.ts (shared with the shopping
 * list and the home restock badge). This route just owns the response shape:
 * sort order and the summary stats.
 */

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const result = await buildForecasts(session.user.id);

        result.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'in_stock' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return NextResponse.json({
            success: true,
            data: {
                products: result,
                stats: {
                    totalProducts: result.length,
                    inStock: result.filter((p) => p.status === 'in_stock').length,
                    outOfStock: result.filter((p) => p.status === 'out_of_stock').length,
                    needRestock: result.filter((p) => p.predictions?.needsRestock).length,
                },
            },
        });
    } catch (error: any) {
        console.error('Analytics error:', error);
        return serverError('analytics', error);
    }
}

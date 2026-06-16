import { NextResponse } from 'next/server';
import { predictProductMeta } from '@/lib/gemini';

// Quick sanity check for category/duration prediction.
//   /api/admin/debug-gemini?name=...&brand=...&unit=...&category=<hint>
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'Lays Classic Salted Chips';
    const brand = searchParams.get('brand') || 'Lays';
    const category = searchParams.get('category') || '';
    const unit = searchParams.get('unit') || '26g packet';

    const meta = await predictProductMeta(name, brand, category, unit);
    return NextResponse.json({ input: { name, brand, category, unit }, meta });
}

import { NextResponse } from 'next/server';
import { predictProductMeta } from '@/lib/gemini';
import { predictWithLocalLlm } from '@/lib/localLlm';

// Quick sanity check for category/duration prediction.
//   /api/admin/debug-gemini?name=...&brand=...&unit=...&category=<hint>
//   add &local=1 to exercise the local Ollama tier directly.
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name') || 'Lays Classic Salted Chips';
    const brand = searchParams.get('brand') || 'Lays';
    const category = searchParams.get('category') || '';
    const unit = searchParams.get('unit') || '26g packet';

    if (searchParams.get('local') === '1') {
        const t = Date.now();
        const meta = await predictWithLocalLlm(name, brand, category, unit);
        return NextResponse.json({ tier: 'local-ollama', ms: Date.now() - t, input: { name, brand, category, unit }, meta });
    }

    const meta = await predictProductMeta(name, brand, category, unit);
    return NextResponse.json({ input: { name, brand, category, unit }, meta });
}

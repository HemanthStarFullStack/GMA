// Render "how much is in stock" from the two fields the model stores separately:
//   quantity = number of packs on hand (a count, e.g. 1)
//   unit     = the size of one pack ("400 g", "1 L") OR a count word ("units")
//
// Naively printing `${quantity} ${unit}` gives nonsense like "1 400" (one pack,
// 400 g) or "1 units". This formats them sensibly instead.
export function formatStock(quantity: number, unit?: string | null): string {
    const qty = Number.isFinite(quantity) ? quantity : 0;
    const u = (unit ?? '').trim();
    // No size, or a bare count word → "1 unit" / "3 units".
    if (!u || /^(units?|pcs?|pieces?|count|ct|nos?)$/i.test(u)) {
        return `${qty} ${qty === 1 ? 'unit' : 'units'}`;
    }
    // `unit` is a pack size ("400 g", "1 L", or a bare "400"). For a single pack
    // just show the size; for more, show "2 × 400 g" so it never reads as "2 400".
    return qty === 1 ? u : `${qty} × ${u}`;
}

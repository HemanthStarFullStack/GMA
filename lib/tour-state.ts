export type TourPhase = 'home' | 'inventory' | 'shopping' | 'analytics' | 'history' | 'settings';

// Tracks ONLY the in-progress phase so the multi-page tour survives navigation.
// Keyed by userId so an abandoned tour never leaks into a different account in
// the same browser. Whether the tour should run AT ALL is decided by the server
// (`user.tourCompleted`), never by localStorage — localStorage is browser-global
// and would otherwise suppress the tour for every account on this machine.
const KEY = 'gma_tour';

function safe<T>(fn: () => T, fallback: T): T {
    try { return fn(); } catch { return fallback; }
}

export const getPhase = (userId: string): TourPhase | null =>
    safe(() => {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const { u, p } = JSON.parse(raw) as { u: string; p: TourPhase };
        return u === userId ? p : null; // stale entry from another account → ignore
    }, null);

export const setPhase = (userId: string, p: TourPhase | null): void =>
    safe(() => {
        if (p) localStorage.setItem(KEY, JSON.stringify({ u: userId, p }));
        else localStorage.removeItem(KEY);
    }, undefined);

export const clearPhase = (): void =>
    safe(() => localStorage.removeItem(KEY), undefined);

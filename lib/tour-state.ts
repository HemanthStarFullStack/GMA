export type TourPhase = 'home' | 'inventory' | 'shopping' | 'analytics' | 'history' | 'settings';

const KEY = 'gma_tour';
const DONE = 'gma_tour_done';

function safe<T>(fn: () => T, fallback: T): T {
    try { return fn(); } catch { return fallback; }
}

export const getPhase = (): TourPhase | null =>
    safe(() => (localStorage.getItem(KEY) as TourPhase) || null, null);

export const setPhase = (p: TourPhase | null): void =>
    safe(() => { p ? localStorage.setItem(KEY, p) : localStorage.removeItem(KEY); }, undefined);

export const isTourDone = (): boolean =>
    safe(() => !!localStorage.getItem(DONE), false);

export const markTourDone = (): void =>
    safe(() => { localStorage.setItem(DONE, '1'); localStorage.removeItem(KEY); }, undefined);

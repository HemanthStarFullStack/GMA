// Throwaway sim: family-size re-estimation drift over cycles.
// Replicates exact math from app/api/user/route.ts lines 27-34.
// Run: node scripts/sim-familysize.mjs

// One pantry item, some stock. Estimate = currentStock * averageDuration (days).
const STOCK = 1; // 1 unit on shelf

// --- exact formulas from user/route.ts ---
const precise = (rate, newN) => Math.max(1, Math.round(1 / (rate * newN)));
const legacy  = (avg, oldN, newN) => Math.max(1, Math.round((avg * oldN) / newN));

// 10 family-size changes, 1 day apart. Round-trippy sequence to expose drift.
const sizes = [1, 2, 3, 4, 3, 2, 1, 2, 4, 1]; // last==first → estimate should match start

// --- PRECISE path: rate fixed at scan. 1 person eats 1/14 unit/day. ---
const RATE = 1 / 14; // perPersonDailyRate
console.log("PRECISE path (perPersonDailyRate stored):");
let N = 1;
let dur = precise(RATE, N);
console.log(`  day 0  N=${N}  avgDuration=${dur}d  estimate=${STOCK * dur}d`);
sizes.slice(1).forEach((newN, i) => {
    dur = precise(RATE, newN);
    console.log(`  day ${i + 1}  N=${N}->${newN}  avgDuration=${dur}d  estimate=${STOCK * dur}d`);
    N = newN;
});
const preciseEnd = dur;

// --- OLD legacy path (buggy): rescale current avg each change. ---
console.log("\nOLD legacy path (rescale avg — buggy):");
N = 1;
let lavg = 14; // catalogue default
console.log(`  day 0  N=${N}  avgDuration=${lavg}d  estimate=${STOCK * lavg}d`);
sizes.slice(1).forEach((newN, i) => {
    lavg = legacy(lavg, N, newN);
    console.log(`  day ${i + 1}  N=${N}->${newN}  avgDuration=${lavg}d  estimate=${STOCK * lavg}d`);
    N = newN;
});
const legacyEnd = lavg;

// --- NEW legacy path (fixed): back-derive rate once, then precise. ---
console.log("\nNEW legacy path (back-derived rate — fixed):");
N = 1;
let favg = 14; // catalogue default before first change
const fixedRate = 1 / (Math.max(1, favg) * Math.max(1, N)); // derived once at first change
console.log(`  day 0  N=${N}  avgDuration=${favg}d  estimate=${STOCK * favg}d`);
sizes.slice(1).forEach((newN, i) => {
    favg = precise(fixedRate, newN);
    console.log(`  day ${i + 1}  N=${N}->${newN}  avgDuration=${favg}d  estimate=${STOCK * favg}d`);
    N = newN;
});
const fixedEnd = favg;

// --- verdict: sequence returns to N=1, so estimate should return to start ---
const preciseStart = precise(RATE, 1);
console.log(`\nPRECISE:    start=${preciseStart}d  end(N=1)=${preciseEnd}d  drift=${preciseEnd - preciseStart}d`);
console.log(`OLD legacy: start=14d  end(N=1)=${legacyEnd}d  drift=${legacyEnd - 14}d  <- BUG`);
console.log(`NEW legacy: start=14d  end(N=1)=${fixedEnd}d  drift=${fixedEnd - 14}d  <- fixed`);
if (fixedEnd !== 14) throw new Error("FAIL: fixed legacy still drifts");
console.log("PASS: fixed legacy returns to start, no drift.");

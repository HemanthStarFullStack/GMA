# GMA — Grocery Management Application

> Internal reference doc. Written from reading the source directly (not assumed).
> Where something was **not** verified in the code, it says so explicitly.
> Last verified against the repo: this covers the code as committed up to commit `9d5d3b8`.

---

## 1. What it is & why

GMA is a household grocery tracker. The core idea: **scan what you buy → track what's in the house → learn how fast you use each thing → warn you before you run out → tell you what to buy.**

Tagline in the UI: *"Restock before you run out."*

It is a single Next.js app (App Router) backed by MongoDB, deployed via Docker behind a Cloudflare Tunnel. Live at **https://gma.hemanthify.in**.

The "intelligence" is consumption forecasting: from past consumption logs + current stock + household size, it computes a per-product run-out date (time-weighted by how household size changed over each lot's life). Product identity (name/brand/size/category) and shelf-life come from an AI pipeline at scan time, with deterministic fallbacks so nothing ever hard-fails.

---

## 2. Stack

- **Framework**: Next.js 16 (App Router, Turbopack), React 19, TypeScript, output `standalone`.
- **Styling**: Tailwind CSS v4 (PostCSS). Custom palette tokens (`ink`, `paper`, `terracotta`, `olive`, `berry`, `amber`, `line`, etc.) + utility classes (`pantry-card`, `kicker`, `btn-primary`, `btn-ghost`, `pill`, `rise`) defined in `app/globals.css`.
- **DB**: MongoDB 7, accessed two ways:
  - **Mongoose** (`lib/mongodb.ts`) for all app data (products, inventory, logs, shopping).
  - **MongoClient** (`lib/mongodb-client.ts`) for the NextAuth MongoDB adapter.
- **Auth**: NextAuth v5 (beta), **JWT session strategy**, MongoDB adapter for user/account storage.
- **AI/external**: Gemini (primary label reader; prediction fallback), Groq (primary label structurer AND primary predictor), self-hosted Qwen3-VL via llama.cpp (label OCR fallback), Ollama (structurer + prediction fallback), PP-OCRv5 ONNX sidecar (last-resort OCR). All optional — app degrades gracefully if any are absent, but with both keys set, cloud APIs are the default path, not the fallback.
- **Deploy**: Docker Compose (`app`, `ocr`, `mongodb`; optional `mongo-express`, `cloudflared`).
- **Dependencies of note** (`package.json`): `driver.js` (guided tour), `lucide-react` (icons), `date-fns` (date formatting), `framer-motion`, `recharts`, `@rive-app/*`, `@opeepsfun/open-peeps` (animation/avatar libs — **not encountered in the page/component files reviewed in this pass**; likely tied to home-page household-avatar work per project history, unverified here), `playwright` (dev-only, screenshots/testing).

Node ≥ 20.

---

## 3. Repository layout (paths)

```
app/
  layout.tsx            Root layout: fonts (Fraunces/Hanken/Geist Mono), <Providers>, metadata
  providers.tsx         <SessionProvider> + <GmaTour/> (mounted on every page)
  globals.css           Tailwind + design tokens + component classes
  page.tsx              "/" Home (server component): hero card, shopping tile, nav tiles
  login/page.tsx        "/login" Google sign-in + dev test-user button
  inventory/page.tsx    "/inventory" pantry list, search/sort/filter, ±adjust, consume, delete
  scan/page.tsx         "/scan" photo OCR → confirm form / manual add → save
  shopping/page.tsx     "/shopping" auto + manual shopping list
  analytics/page.tsx    "/analytics" per-product forecast list + detail
  history/page.tsx      "/history" consumption log + "Buy again"
  settings/page.tsx     "/settings" household size + survey frequency
  api/
    auth/[...nextauth]/route.ts   NextAuth handlers
    user/route.ts                 GET/PUT user settings (familySize, surveyFrequency, tourCompleted)
    inventory/route.ts            GET/POST/PATCH/DELETE inventory
    history/route.ts              GET (logs) / POST (consume → log + decrement/delete)
    analytics/route.ts            GET forecasts (+ summary stats)
    shopping-list/route.ts        GET (auto-sync)/POST (manual)/PATCH (check/uncheck/dismiss)/DELETE
    product-vision/route.ts       POST image → OCR → {name,brand,flavor,quantity,price}
    predict/route.ts              POST product details → {averageDuration, category, perPersonDailyRate}
    upload/route.ts               POST image file → /uploads/<uuid>.<ext>
    demo/route.ts                 POST (seed sample data) / DELETE (wipe demo data)
    health/route.ts               GET liveness/readiness (DB ping)
    admin/
      reset/route.ts              POST wipe data collections (admin-guarded, ?confirm=RESET)
      refresh-durations/route.ts  POST re-predict averageDuration for stale products
      backfill-rates/route.ts     POST backfill perPersonDailyRate
      debug-gemini/route.ts       GET diagnostic (admin-guarded) — not reviewed in detail
components/
  Tour.tsx              GmaTour — multi-page guided tour (driver.js)
  PhotoCapture.tsx      Camera capture UI + "Manual" entry button (scan page)
  ProductCard.tsx       Inventory item card: image, qty stepper, Mark consumed / Delete
  HeroCard.tsx          Home hero: rotating low-stock item / empty / guest teaser
  UserMenu.tsx          Avatar dropdown → sign out
lib/
  models.ts             Mongoose schemas: User, Account, Session, VerificationToken,
                        Product, Inventory, ConsumptionLog, ShoppingList
  mongodb.ts            Mongoose connection (cached)
  mongodb-client.ts     MongoClient promise for the NextAuth adapter
  forecast.ts           buildForecasts / isLow
  depletion.ts          Time-weighted stock depletion math (personDays, depletion)
  inventory.ts          addToInventory (increment-or-create, unit resolution)
  gemini.ts             predictProductMeta (AI shelf-life + category), CATEGORIES, normalizeCategory
  labelStructure.ts     structureLabel (Groq → Ollama) brand/name/flavor from OCR text
  visionOcr.ts          readLabelText / readBackFields (Qwen3-VL via llama.cpp)
  parseLabel.ts         Deterministic OCR→fields (regex qty/price, font-size name/brand)
  groceryPool.ts        findProductTerm — product-term dictionary (grocery-pool.json)
  grocery-pool.json     The product-term pool
  localLlm.ts           predictWithLocalLlm — Ollama prediction fallback tier
  formatStock.ts        formatStock(qty, unit) → "1 L" / "2 × 400 g" / "3 units"
  tour-state.ts         localStorage phase tracking for the multi-page tour
  adminGuard.ts         requireAdmin (x-admin-secret header check)
  apiError.ts           serverError (log server-side, generic client message)
auth.ts                 NextAuth init (adapter + jwt + authConfig)
auth.config.ts          Providers (Google + dev "test"), session/jwt callbacks, signIn page
middleware.ts           Route protection (redirect unauthed dashboard → /login)
instrumentation.ts      Startup env validation (fail fast in prod)
next.config.ts          standalone, security headers + CSP, serverExternalPackages
Dockerfile              Multi-stage build → standalone runner (non-root, healthcheck)
docker-compose.yml      app + ocr + mongodb (+ mongo-express dev profile)
docker-compose.cloudflare.yml  Cloudflare Tunnel overlay (no host port)
ocr/                    PP-OCRv5 sidecar service (Dockerfile + server.js) — internals not reviewed
scripts/                Dev/inspection scripts (*.mjs) — untracked, not part of the app
```

---

## 4. Data model (`lib/models.ts`)

**Key convention: `productId` everywhere == `Product.barcode` (a string).** There is no ObjectId join between Inventory/ConsumptionLog/ShoppingList and Product — they all reference the barcode string. The "barcode" is a stable product key, **not** an actual scanned EAN (the app is photo/OCR-based; there is no barcode scanner). Barcode formats seen: `OCR-<slug>`, `MANUAL-<ts>`, `DEMO-<userId>-<KEY>`.

### User
NextAuth-managed doc + app fields: `email` (unique), `displayName`, `familySize` (default 1), `demoSeeded`, `tourCompleted`, `familySizeChangedAt`, `prevFamilySize`, `familySizeLog: [{size, from}]` (household size over time, for time-weighted depletion), `preferences.surveyFrequency: 'always'|'occasional'`.

### Product (shared global catalogue + self-learning cache)
`barcode` (unique), `name`, `brand`, `flavor`, `price` (free-form string), `category`, `imageUrl`, `defaultUnit` (pack size string, e.g. "1 L"), `averageDuration` (days one unit lasts **for the current household**), `perPersonDailyRate` (units/day for 1 person — enables math-only re-estimation on household change), `aiPredicted`, `addedBy: 'barcode'|'manual'|'demo'`, `source`, `isDemo`. **Never deleted on consume** (it's the catalogue).

### Inventory
`userId` (string, indexed), `productId` (barcode), `quantity` (pack **count**, e.g. 3), `unit` (pack **size** string), `purchaseDate`, `status: 'active'|'consumed'|'wasted'|'expired'`, `isDemo`.

### ConsumptionLog
`userId` (indexed), `productId`, `inventoryId`, `consumedDate`, `durationDays`, `surveyCompleted`, `isDemo`, `surveyData?: {userReportedDays, familySize, flagged, notes}`.

### ShoppingList
`userId` (indexed), `productId?` (present for auto/catalogue items, absent for free-text manual), `name` (denormalized), `reason: 'low_stock'|'out_of_stock'|'manual'`, `source: 'auto'|'manual'`, `status: 'pending'|'done'|'dismissed'`, `boughtAt?` (guards double inventory-add on re-check), timestamps.
- **Partial unique index** on `(userId, productId, source)` where `source:'auto' && productId exists` — makes the auto-sync upsert race-safe (StrictMode double-GET).

---

## 5. Auth (`auth.ts`, `auth.config.ts`, `middleware.ts`)

- **Providers**: Google (`allowDangerousEmailAccountLinking: true` — safe with Google's verified emails). In dev only (`NODE_ENV !== production`): a **"test" Credentials provider** that returns a fixed user `{id: 'test-user-id'}`.
- **Session strategy: JWT** (`session.strategy: 'jwt'`). `jwt` callback copies `user.id → token.sub`; `session` callback copies `token.sub → session.user.id`. So `session.user.id` is the Mongo user `_id` string for real users, and the literal `'test-user-id'` for the dev user.
- **MongoDB adapter** persists users/accounts. Because sessions are JWT (cookie), wiping the DB does **not** log users out — the stale cookie self-heals on next sign-in (new user doc created).
- **Login redirect**: `signIn(..., { redirectTo: "/inventory" })` → real users land on **/inventory**, not home.
- **Middleware** protects (redirects unauthed → `/login`): `/inventory`, `/scan`, `/history`, `/analytics`, `/shopping`, `/settings`. Logged-in users hitting `/login` are bounced to `/scan`. API routes are excluded from middleware and do their own `auth()` checks.

### The "test user" rule (critical, recurring)
`session.user.id === 'test-user-id'` is **not a valid ObjectId**. Routes that touch the `User` collection must guard with `mongoose.Types.ObjectId.isValid(id)` or `User.findById` throws a CastError. Several routes (`user`, `demo`, `predict`) already default/no-op for the test user. `forecast.ts` and the home page were hardened to guard this too (a non-ObjectId id used to 500 the landing page).

---

## 6. API routes — exact behavior

All app routes call `auth()` and 401 if no `session.user.id`. 500s go through `serverError(scope, err, msg)` which logs the real error server-side and returns a generic message (never leaks `error.message`).

### `GET /api/user`
Returns `{name, familySize, surveyFrequency, demoSeeded, tourCompleted}`. Test user → defaults with `tourCompleted: true`. Missing user doc → defaults (`tourCompleted: false`).

### `PUT /api/user`
Body `{familySize?, surveyFrequency?, tourCompleted?}`. Clamps familySize 1–20. **On family-size change**: appends to `familySizeLog` (seeds a baseline at user.createdAt the first time), records `prevFamilySize`/`familySizeChangedAt`, and fires (fire-and-forget) `reestimateForHousehold` — pure-math re-estimation of `averageDuration` for the user's active non-demo products from the stored `perPersonDailyRate` (Personal Care excluded — per-person, never scaled). Returns `{familySize, surveyFrequency, reestimating: <count>}`.

### `GET /api/inventory`
User's inventory sorted by `purchaseDate` desc, each joined with its Product (fallback `{name:'Unknown Product', ...}` if the product is missing).

### `POST /api/inventory`
Body `{productId, quantity?, unit?, productDetails?}`. If `productDetails` present, upserts the Product (confirmed user edits are authoritative; sets `aiPredicted:true` so cache-healing won't overwrite). Then `addToInventory(userId, barcode, qty||1, unit||details.unit)`. Used by scan-save and history "Buy again".

### `PATCH /api/inventory`
Body `{id, delta}` (delta must be non-zero integer). Read-modify-write on the owner's active row.
- **delta < 0** that would drop below 1 → **409** `{code:'AT_MINIMUM'}` (client falls back to the consume/survey flow). Otherwise logs a `ConsumptionLog` (surveyCompleted:false) and **resets `purchaseDate = now`** (lot clock for rate-learning), then decrements.
- **delta > 0** → blends `purchaseDate` toward now weighted by new vs existing units (fresh stock shouldn't read as old), then increments.
- Not atomic (read-modify-write) — fine for single-user use; noted ceiling.

### `DELETE /api/inventory?id=`
Owner-checked `findOneAndDelete`. No consumption logged (pure removal).

### `GET /api/history`
Last 50 ConsumptionLogs (desc), each enriched with product details.

### `POST /api/history` (the **consume** flow)
Body `{productId, inventoryId, durationDays, surveyData}`. Creates a ConsumptionLog **with** surveyData and `surveyCompleted = !!surveyData`. Then: if the inventory row has `quantity > 1` → decrement by 1 and reset `purchaseDate = now`; if `quantity == 1` → delete the row. (Finishes **one** pack; previously deleted the whole row — fixed.)

### `GET /api/analytics`
Thin wrapper over `buildForecasts(userId)` + summary stats + sort. Returns `{products: ProductForecast[], stats}`.

### Shopping list (`/api/shopping-list`)
- **GET**: runs `autoSync(userId)` then returns entries.
  - `autoSync`: `low = buildForecasts().filter(isLow)`. Deletes `source:'auto'` entries whose productId is no longer low (cleans resolved/bought/dismissed). Upserts one pending auto entry per low product (`$setOnInsert` keeps a dismissed-still-low entry suppressed; name/reason refreshed).
  - Returns `items` (pending before done; sorted by reason rank `out_of_stock < low_stock < manual`, then name) + counts. Each enriched with brand/image/defaultUnit.
- **POST** `{name}`: manual pending entry (trim, max 100 chars, reject empty).
- **PATCH** `{id, action}`:
  - `check` ("got it"): for `source:'auto'` + `productId` + not yet `boughtAt` → `addToInventory(userId, productId)` then set `boughtAt` (guards double-add on re-check); status → `done`.
  - `uncheck`: status → `pending` (keeps boughtAt).
  - `dismiss`: status → `dismissed` (stays suppressed while still low).
- **DELETE** `?id=`: owner-checked delete (used for manual items).

### `POST /api/product-vision` (label OCR)
Auth + size guard (min 100 B, max 12 MB). `?side=back` → targeted net-quantity read (`readBackFields`, returns `{quantity, price:''}` — price intentionally not read from back). Front → `readLabelText` (full transcription) → `parseLabel` → if not back-panel and (Groq enabled or low confidence) `structureLabel` overrides brand/name (flavor only if dictionary missed it). Reader order: **Qwen3-VL (host GPU) → PP-OCRv5 sidecar (CPU rescue)**. Back-panel reads drop name/brand (they live on the front). Logs `[vision]` / `[vision:back]` with the parsed result.

### `POST /api/predict`
Body `{name, brand?, flavor?, price?, category?, unit?/size?}`. Pulls householdSize from the user (default 1; guarded for test user). Calls `predictProductMeta` → `{averageDuration, category, perPersonDailyRate, predicted}`.

### `POST /api/upload`
Multipart `file`. Whitelist `image/jpeg|png|webp|gif`, max 5 MB. Writes `public/uploads/<uuid>.<ext>` (persistent Docker volume), returns `{url}`. (Trusts client MIME type — no magic-byte check; low risk since served static with random name.)

### `GET /api/health`
200 only when Mongo `readyState === 1`, else 503. Drives the Docker healthcheck.

### Admin (`/api/admin/*`) — guarded by `requireAdmin`
`requireAdmin`: requires `x-admin-secret` header == `ADMIN_SECRET` env. **If `ADMIN_SECRET` is unset, returns 404** (endpoints disabled — a prod deploy that forgets the secret can't expose a DB wipe).
- `POST /api/admin/reset?confirm=RESET&userId=<id>` — wipes that user's Inventory/ConsumptionLog/ShoppingList, plus the shared Product catalogue (global, keeps users). Double-gated (secret + confirm token) and requires an explicit userId so it can't wipe every account at once.
- `POST /api/admin/refresh-durations` — re-predicts `averageDuration` for products still at the default 14.
- `POST /api/admin/backfill-rates` — backfills `perPersonDailyRate` (+ resets averageDuration to 1-person baseline) for products lacking it.
- `GET /api/admin/debug-gemini` — diagnostic (not reviewed in detail).

---

## 7. Forecasting (`lib/forecast.ts` + `lib/depletion.ts`)

`buildForecasts(userId)` is the **single source of truth** shared by analytics, the shopping list, and the home badge. Steps:
1. Load Inventory + ConsumptionLogs for the user (by string userId) and the User (guarded findById for ObjectId).
2. Join products by barcode.
3. Aggregate current stock per product (sum quantities; collect `rows: [{purchaseDate, qty}]`); status `in_stock`. Products with logs but no stock → status `out_of_stock`.
4. Fold consumption history (timesConsumed, averageDurationDays = mean of durationDays, lastConsumed).
5. For in-stock products with a duration, compute predictions via `depletion()` per lot, summed:

`depletion()` (time-weighted):
- `r` = units per person per day = stored `perPersonDailyRate`, else `1/(averageDuration * sizeFactorNow)`.
- `sizeFactorNow` = household size (or 1 for **Personal Care**, which is per-person).
- `personDays(purchase, now, sizeLog, size)` = ∫ household-size over the lot's life (segments from `familySizeLog`; earliest size extrapolated backward). Personal Care uses plain days (factor 1).
- `consumed = r * personDays`; `remaining = max(0, qty - consumed)`; `daysLeft = remaining / (r * sizeFactorNow)`.
- With no size changes this reduces exactly to `qty*averageDuration - daysSincePurchase` (no regression).

Predictions object: `{consumptionRate (round 2dp), daysUntilEmpty (round 1dp), restockDate (ISO), needsRestock (daysUntilEmpty < 7)}`.

`isLow(p)` = `currentStock <= 1` — a plain visible rule, deliberately not coupled to the run-out forecast (see the doc comment on `isLow` in forecast.ts).

---

## 8. AI / prediction pipeline (`lib/gemini.ts`, `labelStructure.ts`, `visionOcr.ts`, `parseLabel.ts`, `localLlm.ts`)

### Shelf-life + category — `predictProductMeta(name, brand, categoryHint, unit, extra)`
Returns `{averageDuration, category, predicted, perPersonDailyRate}`. **Tiers (never hard-fail):**
1. **Groq** (text, `openai/gpt-oss-120b` by default, separate quota from the Gemini image reader) — primary.
2. **Gemini** (`gemini-2.5-flash-lite` → `gemini-2.5-flash`, separate quota buckets, JSON mode, thinking disabled, 9 s timeout) — fallback if Groq is down/over quota. Prompt asks the model to reason step-by-step for **one unit, one person**: unitSize → servingsPerUnit → dailyUse → averageDuration (whole days, ≥1) → category (from the fixed 12-item list). Few-shot examples calibrate sizes. The app then **scales per-person → household in code** (`÷ householdSize`, except Personal Care). `perPersonDailyRate = dailyUse/servingsPerUnit`.
3. **Local LLM** (`lib/localLlm.ts`, Ollama, with web_search) — only if Groq and Gemini both fail; instant skip if Ollama down.
4. **Heuristic fallback**: `{averageDuration: forHousehold(14), category: normalizeCategory(hint), predicted:false}`.

`CATEGORIES` (the 12) live in `gemini.ts` and are the single source of truth. `normalizeCategory` maps loose strings onto them.

### Label OCR — `lib/visionOcr.ts`
Primary **Gemini** flash (`FRONT_READER=gemini`, the default whenever `GEMINI_API_KEY` is set) — ~10x faster than the local VLM and scored higher in the 35-scan eval, and it frees the local GPU during scans. Falls back to local **Qwen3-VL-2B** (Q4) served by llama.cpp `llama-server` (OpenAI-compatible) on the host GPU (`VISION_OCR_URL`) if Gemini is unset/down. Two modes: `full` (transcribe everything, front) and `back` (ask **only** for net quantity, grounded — copy printed digits, never compute; price deliberately not asked because a small model fabricates MRPs). 30 s reachability cache; 60 s read timeout. Fail-soft → null → caller uses the PP-OCRv5 sidecar as the last resort.

### Label structuring — `lib/labelStructure.ts`
`structureLabel(text)` turns OCR text into `{brand, name, flavor}`. Primary **Groq** (default `openai/gpt-oss-120b`, JSON mode, free tier) → fallback **Ollama** (`qwen2.5:1.5b`). Anti-hallucination: brand/flavor words **must** appear in the OCR text; name may also be a known generic product TYPE (`TYPE_WORDS`) so "Juice" can be inferred for a brand+flavor-only front, but "Foggy Juice" can't be fabricated. `GROQ_ENABLED` (key present) makes structuring run even on confident parses.

### Deterministic parser — `lib/parseLabel.ts` + `groceryPool.ts`
No AI: regex for quantity (prefers declared net quantity) and price, back-panel detection, and font-size heuristics for name/brand. `findProductTerm` matches lines against a product-term dictionary (`grocery-pool.json`) to tell product (has a pool term) from brand (the leftover prominent line); marketing/claim text and generic packaging words are filtered out so they don't hijack the name/brand or mark a parse "confident".

---

## 9. Key flows / user journeys

### A. Onboarding + guided tour (`components/Tour.tsx`, `lib/tour-state.ts`, `api/demo`)
- `GmaTour` is mounted globally (in `providers.tsx`) and watches `usePathname()`.
- **Source of truth for "should the tour run" is the server** (`user.tourCompleted`), **not** localStorage. localStorage (`gma_tour`, keyed by userId) only tracks the in-progress **phase** so the tour survives page navigation; an abandoned tour can't leak into another account.
- First-time user (tourCompleted false) landing on `/` or `/inventory`: set phase `home`, **await** `POST /api/demo` (the tour is the **sole** demo seeder — the inventory page no longer seeds, to avoid a race), then if on `/inventory` bounce to `/` to start at home.
- Phases: **home → inventory → shopping → analytics → history → settings**. Each phase waits (polls ≤4 s) for its page's real item element to render, then drives driver.js steps that highlight a real seeded item per page. "Continue" advances phase + navigates; finishing (settings) or skipping → `clearPhase()` + cleanup (`PUT tourCompleted:true` + `DELETE /api/demo`). `runId` guard prevents navigation firing on manual page changes / cleanup.
- **Demo data** (`api/demo` POST): seeds ~7 products with **real brand packshots from Open Food Facts** + consumption logs + stock (some in-stock, some out-of-stock so all pages have data). Idempotent (atomic `demoSeeded` flip). Records tagged `isDemo:true` and barcodes are `DEMO-<userId>-<KEY>`.
- **Demo cleanup** (`api/demo` DELETE): deletes everything referencing the `DEMO-<userId>-` barcode (Inventory, ConsumptionLog, ShoppingList) **regardless of the `isDemo` flag**, plus the demo Products. (The barcode-pattern match is essential: shopping "got it" on a demo item creates a *non-demo* inventory row that would otherwise survive as an orphaned "Unknown Product".) Manual shopping items (no productId) are preserved.

### B. Scan a product (`app/scan/page.tsx`, `components/PhotoCapture.tsx`)
Modes: `scan → confirm | manual → saving → done`.
1. **scan**: `PhotoCapture` (live camera) or "Manual" button.
2. Photo → `POST /api/product-vision` (and a parallel best-effort `POST /api/upload` so the shot doubles as the product photo). OCR result fills the form; `void autoEstimate()` fires `POST /api/predict` in the background to fill duration/category without blocking the form. Back panel → fills size; missing name → nudge to shoot the front.
3. **confirm/manual form** (all fields editable): name*, brand, flavor, size/weight (`unit`), price, category, quantity (± stepper), "Typically lasts" (averageDuration number field + "Re-estimate" → `/api/predict`). Optional **"Scan the back for size"** → `POST /api/product-vision?side=back`.
   - **Back-scan merge rule**: only fills size/price if the value *looks like* a real size (`SIZE_RE`, ≤24 chars) / price (`PRICE_RE`) **and** the front didn't already have one — so the back panel's junk text can't clobber a correct front read.
   - **Number field rule**: duration field (and the survey days field) allow empty while typing and clamp on blur — so a prefilled value can be erased and retyped.
4. **save** → `POST /api/inventory` with `productDetails`. productId is `OCR-<slug>` (OCR source) or the barcode / `MANUAL-<ts>`. Redirects to `/inventory`.

### C. Inventory management (`app/inventory/page.tsx`, `components/ProductCard.tsx`)
- Loads inventory + user familySize. Search (name/brand), sort (recent / name / qty), section filter chips (Staples/Fresh/Snacks/Drinks/Frozen/Condiments/Household/Other — mapped from categories).
- Each card: **− / qty / +** stepper. `+` → `PATCH +1`. `−` at qty>1 → `PATCH -1`; `−` at qty 1 → `handleConsume` (survey). **"Mark consumed"** → survey (`ProductSurvey`) → `POST /api/history` (decrement one pack or delete the last). **"Delete"** → `DELETE` (no log). On `PATCH` 409 (`AT_MINIMUM`) the client falls back to the consume flow.

### D. Consume survey (`components/ProductSurvey.tsx`)
"How long did it last?" quick buttons (3d/1w/2w/1m) or custom days. Flags an anomaly if reported is >30% off the expected duration (reveals an optional notes box). Submits `{userReportedDays, notes}`; the page adds `familySize` + `flagged` and posts to `/api/history` (now persisted in `surveyData`).

### E. Shopping list (`app/shopping/page.tsx`)
Auto-synced low/out-of-stock items + manual items. Check ("got it") re-adds auto items to inventory; dismiss (auto) / delete (manual); collapsed "Got it" done section. Empty state when nothing low and no manual items.

### F. Analytics (`app/analytics/page.tsx`)
Two-pane (list + detail) on desktop; on mobile a product auto-selects and the detail shows (list is `hidden md:block`). Detail: current stock, consumption history (units used, avg days/unit, last used), forecast (consumption rate, days until empty, restock date, "restock soon" if needsRestock).

### G. History + Buy again (`app/history/page.tsx`)
Consumption log cards (image, name, date, "Lasted N days"). **"Buy again"** → `POST /api/inventory {productId}` (re-adds via `addToInventory`, resolving the real `defaultUnit`); per-row idle→loading→"Added".

### H. Settings (`app/settings/page.tsx`)
Family size (± 1–20) and survey frequency (occasional/always). Save → `PUT /api/user`; if family size changed, shows how many products are being re-estimated.

### I. Home (`app/page.tsx`)
Server component. Hero card (rotating most-urgent low-stock item / empty / guest teaser via `HeroCard`), shopping-list tile (doubles as restock badge — shows `lowStockCount`), 2×2 nav tiles. Data fetches are **non-fatal** (`.catch` → safe defaults) so a DB/forecast hiccup never 500s the landing page.

---

## 10. `addToInventory` (`lib/inventory.ts`)
Shared by inventory POST, history "Buy again", and shopping "got it". Increment the user's existing **active** row for a barcode (blending `purchaseDate` toward now, weighted by new vs existing units) or create one. Unit resolution: explicit override → `Product.defaultUnit` → `'units'`. Not atomic against concurrent adds of the same barcode (single-user ceiling).

---

## 11. Environment variables (from `docker-compose.yml` + code)

| Var | Purpose | Default / notes |
|---|---|---|
| `MONGODB_URI` | Mongo connection | compose: `mongodb://<user>:<pass>@mongodb:27017/<db>?authSource=admin` |
| `AUTH_SECRET` | NextAuth secret | **required in prod** (instrumentation throws if missing) |
| `AUTH_URL` / `NEXTAUTH_URL` | Public URL | `https://<APP_DOMAIN>` under Cloudflare |
| `AUTH_TRUST_HOST` | NextAuth behind proxy | `"true"` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | sign-in disabled if unset (warn) |
| `GEMINI_API_KEY` | Primary label reader (front/back); prediction fallback if Groq is down | falls back to local Qwen3-VL/LLM/heuristic if unset |
| `GROQ_API_KEY` / `GROQ_MODEL` | Primary label structurer AND primary predictor | default `openai/gpt-oss-120b` |
| `VISION_OCR_URL` | Qwen3-VL llama.cpp server | compose default `http://host.docker.internal:8185` |
| `OCR_URL` | PP-OCRv5 sidecar | `http://ocr:4000` |
| `OLLAMA_URL` / `OLLAMA_STRUCT_MODEL` / `OLLAMA_MODEL` | local LLM fallbacks | host Ollama |
| `LABEL_LLM_ENABLED` / `LOCAL_LLM_ENABLED` / `VISION_OCR_ENABLED` | feature toggles | |
| `ADMIN_SECRET` | admin endpoints | **unset ⇒ admin routes return 404 (disabled)** |
| `MONGO_USER` / `MONGO_PASSWORD` / `MONGO_DB` | mongo init | `admin` / `changeme` / `gma` |
| `APP_DOMAIN` / `TUNNEL_TOKEN` | Cloudflare overlay | |

`instrumentation.ts` fails fast in production if `MONGODB_URI` or `AUTH_SECRET` is missing; warns on missing Google/Gemini keys.

---

## 12. Deployment

- **Image**: multi-stage `Dockerfile` (deps → builder → runner). Runner is non-root (`nextjs:nodejs`), runs `node server.js` (Next standalone), `EXPOSE 3000`, container `HEALTHCHECK` hits `/api/health`. Build injects a dummy `MONGODB_URI` (some modules read it at import time).
- **Compose**: `app` (port 3000), `ocr` (PP-OCRv5 sidecar, internal only, `expose 4000`), `mongodb` (mongo:7, **internal only — not published to the host**; access via the `dev` profile's `mongo-express` on 127.0.0.1:8081, or a temporary throwaway/forwarder). Volumes: `mongodb_data`, `mongodb_config`, `gma_uploads` (→ `/app/public/uploads`).
- **Public exposure**: `docker-compose.cloudflare.yml` overlay adds a `cloudflared` tunnel and **removes the app's host port** (only cloudflared reaches the app over the compose network). Live at **gma.hemanthify.in**.
- **Deploy command** (prod, live):
  ```
  docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build app
  ```
- CI/CD: a self-hosted GitHub Actions runner auto-deploys on push (per project history; `.github/workflows/ci.yml` exists — not reviewed in this pass).

---

## 13. Conventions, gotchas & invariants

- **`productId === barcode` (string)** everywhere. No ObjectId product joins.
- **Test user** (`'test-user-id'`) is non-ObjectId → guard every `User.findById`/ObjectId op.
- **JWT sessions** → DB wipe doesn't force logout; stale cookie self-heals on next sign-in.
- **Mongo is not host-exposed** in prod compose — to inspect/seed from the host, use `mongo-express` (dev profile) or a throwaway container; never bind the prod mongo to a host port casually (it holds real user data).
- **`isDemo` tagging** + the `DEMO-<userId>-` barcode pattern scope all demo data; cleanup matches by barcode pattern (not just the flag).
- **Security**: every mutation is owner-checked by `userId`. Admin endpoints 404 without `ADMIN_SECRET`. `serverError` never leaks internals. `next.config.ts` sets nosniff, frame-options SAMEORIGIN, referrer-policy, permissions-policy (`camera=self`), and a CSP (permissive on script — Next inline bootstrap — but `object-src none`, locked `base-uri`/`form-action`, `frame-ancestors self`, `img-src` allows https for remote packshots).
- **`formatStock(qty, unit)`**: `unit` is the pack **size** ("400 g"), `quantity` is the **count**. Renders "400 g" (qty 1), "2 × 400 g" (qty>1), or "N units" when unit is a bare count word.
- **No barcode scanner** exists (removed `/api/barcode` route — it was dead code and an unauth'd paid-AI cost vector). The "barcode" field is just the product key.
- **Repo hygiene**: stray command-fragment junk files sometimes appear in the repo root (from mis-redirected shell output) — never `git add -A`. `.gitignore` ignores `*.gguf` (local model weights) and `/public/uploads/`.

---

## 14. Notable recent fixes (context for future me)

- Favicon: real GMA multi-size `app/favicon.ico` (PNG-in-ICO) so browsers' auto `/favicon.ico` request resolves.
- Multi-page tour rewritten; server `tourCompleted` is the source of truth; demo images are real OFF packshots; tour is the sole demo seeder (race fixed); demo cleanup matches by barcode pattern (orphan "Unknown Product" fixed).
- Scan: "Add/Replace photo" no longer forces the camera (removed `capture` on the gallery input; kept it on the back-scan input). Back-scan won't clobber a good front size/price (validates + only fills empties).
- Consume (`POST /api/history`): finishes one pack (decrement vs delete-all) and persists `surveyData`/`surveyCompleted`.
- Number fields (scan duration, survey days) are clearable.
- Landing page + `buildForecasts`/`getHeroItems` hardened against non-ObjectId ids and DB errors.
- Hardening: middleware covers all dashboard routes; `serverError` helper replaces 19 `error.message` leaks; CSP added.

---

## 15. Verified-vs-not

**Read & verified this pass**: all `app/api/*` routes (except `admin/debug-gemini` only skimmed), all `app/*/page.tsx`, `layout.tsx`, `providers.tsx`, `middleware.ts`, `auth.ts`, `auth.config.ts`, `next.config.ts`, `instrumentation.ts`, `Dockerfile`, both compose files, `package.json`, `lib/{models,mongodb,mongodb-client,forecast,depletion,inventory,gemini,labelStructure,visionOcr,parseLabel(top),groceryPool,formatStock,tour-state,adminGuard,apiError}.ts`, `components/{Tour,ProductSurvey,ProductCard,HeroCard,UserMenu}.tsx`, `components/PhotoCapture.tsx` (relevant parts).

**Not fully read (describe with caution)**: `ocr/` sidecar internals, `lib/localLlm.ts` internals (purpose known: Ollama prediction tier), `lib/parseLabel.ts` full body (top + approach known), `app/globals.css` token values, `app/api/admin/debug-gemini`, `scripts/*`, `server.js` (Next standalone entry), `.github/workflows/ci.yml`, and the animation deps (`framer-motion`, `recharts`, `@rive-app/*`, `@opeepsfun/open-peeps`) — present in `package.json` but their usage was not located in the files reviewed.

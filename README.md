# GMA — Grocery Management Application

Scan your groceries, track what's in your household, and get warned **before you run out**.
GMA estimates how long each product lasts, learns your real consumption rhythm over time,
and projects run-out dates so you restock at the right moment — no spreadsheets, no guesswork.

---

## What it does

1. **Scan a barcode** (or add manually). GMA resolves the product, predicts how many days
   one unit lasts for one person, and files it into the right shelf.
2. **Track your pantry** — items are grouped into intuitive shelves (Staples, Fresh,
   Snacks, Drinks, Frozen, Condiments, Household, Other) with a per-item stock bar.
3. **Log consumption** when you finish something. A short survey captures how long it
   actually lasted, which sharpens future predictions.
4. **See run-out forecasts** — analytics turns your habits into "restock by" dates.

A guided tour seeds a sample household on first login so the dashboard is alive
immediately; clear it anytime from Settings.

---

## How it works

### Product resolution (never dead-ends)
When you scan a barcode, GMA resolves it in order and stops at the first hit:

1. **Local catalogue (shared cache)** — any product *any* account has resolved before is
   stored, keyed by barcode. A repeat scan by anyone returns instantly with **zero** API
   or AI calls. This is the app's lightweight RAG store.
2. **[UPCitemDB](https://www.upcitemdb.com/)** — broad US/international coverage.
3. **[OpenFoodFacts](https://world.openfoodfacts.org/)** — grocery coverage + product images.
4. **Manual add** — a 5-second form when nothing matches; saved to the catalogue forever after.

### Consumption + category prediction (tiered, self-healing)
For a newly-seen product, GMA estimates **how long one unit lasts** and **which category**
it belongs to, using a fallback ladder so it never hard-fails:

```
Gemini 2.5 flash-lite  →  Gemini 2.5 flash  →  local Ollama LLM  →  heuristic (14d / "Other")
   (primary)              (separate quota)      (offline backup)      (last resort)
```

- The prompt makes the model **reason about pack size** step by step
  (`unitSize → servingsPerUnit → dailyUse → averageDuration`), so a 330 ml can,
  a 1.2 L bottle, and a 2.25 L bottle of the same drink get different shelf-lives.
- The **local Ollama tier** (`llama3.2:3b` by default) only runs when Gemini is
  rate-limited/unavailable. It has a **web-search tool** (DuckDuckGo, no key) for
  unfamiliar products. It loads on-demand, runs GPU-resident at a capped context
  (`num_ctx`), and **unloads immediately** (`keep_alive: 0`) — zero idle footprint.
  Disable with `LOCAL_LLM_ENABLED=false`.
- **Self-healing cache:** a product cached during an outage (heuristic fallback) is
  flagged `aiPredicted: false` and re-predicted on its next scan, fixing it for everyone.
- The category you confirm on the scan form is authoritative — it overwrites any stale
  cached value.

### Run-out forecasting
Each product stores an `averageDuration` (days one unit lasts). Combined with quantity in
stock and purchase date, GMA derives a consumption rate and projects **days until empty**,
surfacing the most urgent items first. Consumption surveys feed back to refine estimates.

---

## Architecture

```
Browser (Next.js App Router, React 19)
  │  camera → ZXing barcode decode
  ▼
Route handlers (app/api/*)
  ├─ /barcode      cache → UPCitemDB → OpenFoodFacts, then predict + cache
  ├─ /inventory    add/list/delete; de-dupes by incrementing existing rows
  ├─ /analytics    consumption history → run-out forecasts
  ├─ /history      consumption logs + surveys
  ├─ /user /demo   household settings; seed/clear onboarding
  └─ /health       DB-aware readiness probe
  │
  ├─ lib/gemini.ts     prediction ladder (Gemini → local → heuristic)
  ├─ lib/localLlm.ts   Ollama client + web_search tool
  └─ lib/mongodb.ts    Mongoose connection (cached)
  ▼
MongoDB (Mongoose)
  Users · Products (shared catalogue/cache) · Inventory · ConsumptionLog
  + NextAuth collections (via the MongoDB adapter)
```

### Tech stack
- **Framework:** Next.js 16 (App Router, standalone output) · React 19 · TypeScript
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth v5 (Google) + MongoDB adapter; JWT sessions
- **Database:** MongoDB + Mongoose
- **Barcode:** `@zxing/browser` + `@zxing/library`
- **AI:** Google Gemini → local Ollama LLM → heuristic
- **Deploy:** Docker (multi-stage, non-root) + docker compose

---

## Getting started (local dev)

**Prerequisites:** Node.js 20+, a MongoDB instance (local Docker or Atlas), and a Google
OAuth client. (Gemini/Ollama are optional — the app degrades gracefully without them.)

```bash
# 1. Configure
cp .env.example .env.local        # then fill in AUTH_SECRET, Google OAuth, MONGODB_URI

# 2. (optional) start a local MongoDB
docker compose up -d mongodb

# 3. Install & run
npm install
npm run dev
```

Open <http://localhost:3000>. The camera works on `localhost` (a secure context) with no
HTTPS cert. In development a **Test Account** login is available — no Google needed; it is
automatically disabled when `NODE_ENV=production`.

Generate `AUTH_SECRET` with `npx auth secret`. For Google OAuth, add
`http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

---

## Deploy with Docker

```bash
cp .env.example .env              # set AUTH_SECRET, Google OAuth, GEMINI_API_KEY, etc.
docker compose up -d --build      # app on :3000 + mongodb
docker compose --profile dev up -d   # also mongo-express on :8081 (dev only)
```

- The image is a **multi-stage, non-root** Next.js standalone build with a container
  `HEALTHCHECK` hitting `/api/health`.
- All secrets are injected via `.env` (`${VAR}` interpolation); the app waits for
  MongoDB to be **healthy** before starting.
- The local-LLM fallback expects Ollama on the host
  (`OLLAMA_URL=http://host.docker.internal:11434`); set `LOCAL_LLM_ENABLED=false` to skip it.
- User uploads (`public/uploads`) persist via the `gma_uploads` volume. For multi-instance
  / cloud deploys, switch to object storage (S3/R2).

Helper scripts: `npm run docker:up` · `docker:dev` · `docker:down` · `docker:build`.

---

## Configuration

See [`.env.example`](.env.example) for the full, documented list. Essentials:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AUTH_SECRET` | ✅ | NextAuth signing secret (`npx auth secret`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | prod | Google OAuth |
| `GEMINI_API_KEY` | optional | Primary predictor; falls back to local LLM → heuristic |
| `OLLAMA_URL` / `OLLAMA_MODEL` / `LOCAL_LLM_ENABLED` | optional | Local LLM fallback |
| `ADMIN_SECRET` | optional | Enables `/api/admin/*`; routes 404 without it |

Boot-time validation (`instrumentation.ts`) fails fast if a required variable is missing
in production. Full setup notes in [ENV_SETUP.md](ENV_SETUP.md).

---

## API overview

| Route | Method | Purpose |
|---|---|---|
| `/api/barcode?barcode=` | GET | Resolve a product (cache → external → predict) |
| `/api/inventory` | GET/POST/DELETE | List / add (de-dupes) / remove inventory items |
| `/api/analytics` | GET | Consumption history + run-out forecasts |
| `/api/history` | GET/POST | Consumption logs and surveys |
| `/api/user` | GET/PUT | Household settings (family size, survey pref, tour) |
| `/api/demo` | POST/DELETE | Seed / clear onboarding data |
| `/api/health` | GET | DB-aware readiness probe |

**Admin** (require the `x-admin-secret` header matching `ADMIN_SECRET`; return **404** if
`ADMIN_SECRET` is unset):

| Route | Purpose |
|---|---|
| `POST /api/admin/reset?confirm=RESET` | Wipe inventory, history, and product cache (keeps users) |
| `POST /api/admin/refresh-durations` | Re-predict durations for products still at the default |
| `GET  /api/admin/debug-gemini` | Inspect a single prediction (add `&local=1` for the Ollama tier) |

---

## Project structure

```
app/
  api/            route handlers (see API overview)
  scan/           scan → confirm (with AI category) or manual-add flow
  inventory/      shelf-grouped grid + consumption survey
  analytics/ history/ settings/ login/
  page.tsx        landing + run-low hero carousel
components/        BarcodeScanner, ProductCard, HeroCard, ProductSurvey, Tour, UserMenu
lib/
  gemini.ts        prediction ladder + size-aware prompt
  localLlm.ts      Ollama tier + web_search tool
  adminGuard.ts    admin endpoint guard
  mongodb.ts       Mongoose connection (cached)
  mongodb-client.ts MongoClient for the NextAuth adapter
  models.ts        Mongoose schemas
auth.ts / auth.config.ts   NextAuth setup
middleware.ts      route protection
instrumentation.ts boot-time env validation
Dockerfile · docker-compose.yml · .env.example
```

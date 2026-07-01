# GMA — Grocery Management Application

Snap a photo of a product and GMA tracks your pantry, learns how fast your
household uses each item, and tells you when you'll run out — no barcode
database, no spreadsheets, no per-scan API cost.

> Live: [gma.hemanthify.in](https://gma.hemanthify.in)

---

## What it does

1. **Snap a product.** Reads the label (brand, name, flavor, size, price) into
   an editable form. A second shot of the back panel fills in net quantity + MRP.
2. **Track your pantry.** Items group into shelves (Staples, Fresh, Snacks,
   Drinks, Frozen, Condiments, Household, Other) with a per-item stock bar.
3. **Shopping list.** Items that run low or out surface automatically; add
   anything else by hand. Tick one off and it goes straight back to inventory.
4. **Log consumption** when you finish something — a short survey sharpens
   future duration estimates.
5. **Run-out forecasts.** Analytics turns your stock + usage into "restock by"
   dates, most-urgent first.

A guided tour seeds a sample household on first login; clear it anytime from Settings.

---

## How it works

Every AI-shaped step is a **cloud API first, local model as the offline
fallback** — not the other way around. All three ladders bottom out at a
plain heuristic/regex so a scan or a forecast never dead-ends:

```
            ┌──────────────── READ (pixels → text) ─────────────────┐
photo  ───► Gemini flash (front) — fast, frees the local GPU          │
            └─ fallback: local Qwen3-VL-2B (llama.cpp, host GPU)      │
               └─ fallback: PP-OCRv5 sidecar (CPU container)          │
                                   │ clean text                       │
            ┌──────────── STRUCTURE (text → fields) ─────────────────┤
            ► Groq (Llama-3.3-70b / gpt-oss-120b) → brand + name      │
            └─ fallback: local Ollama qwen2.5:0.5b → parseLabel       │
                                   │                                  │
            flavor  ← parseLabel dictionary                          │
            size / price / back-panel  ← deterministic regex          │
                                   ▼                                  │
                         editable confirm form  ◄─────────────────────┘
```

Back-panel reads (net quantity + MRP) use the same reader chain, targeted so
the output is a couple of fields instead of a full transcription.

Duration + category for a new product, on the same fail-soft pattern:

```
Groq (text)  →  Gemini 2.5 flash-lite  →  Gemini 2.5 flash  →  local Ollama (llama3.2:3b)  →  heuristic
```

A `perPersonDailyRate` is stored per product so re-estimating for a different
household size is pure math, no AI call. Run-out forecasting integrates
consumption over how household size actually varied across an item's life
(not a flat rate), then projects the remainder forward at the current size.

---

## Architecture

```
Browser (Next.js App Router · React 19)
  │  camera → photo
  ▼
Route handlers (app/api/*)
  ├─ /product-vision  read label: Gemini → local Qwen3-VL-2B → PP-OCRv5, then Groq-structure
  ├─ /predict         duration/category for the confirm form
  ├─ /inventory       add/list/delete/adjust qty (de-dupes by incrementing rows)
  ├─ /shopping-list   low/out-of-stock reminders + manual items
  ├─ /analytics       time-weighted depletion → run-out forecasts
  ├─ /history /user /demo /health
  │
  ├─ lib/visionOcr.ts      Gemini flash reader → local Qwen3-VL-2B fallback (llama-server)
  ├─ lib/parseLabel.ts     text → fields heuristics (flavor dict, MRP scorer)
  ├─ lib/labelStructure.ts Groq structurer (brand/name) → local qwen2.5:0.5b fallback
  ├─ lib/depletion.ts      time-weighted stock depletion
  ├─ lib/gemini.ts         Groq → Gemini duration/category ladder
  ├─ lib/localLlm.ts       Ollama llama3.2 fallback + web_search tool
  └─ lib/mongodb.ts        Mongoose connection (cached)
  ▼
MongoDB · Users · Products (shared catalogue/cache) · Inventory · ConsumptionLog · ShoppingList

Host services (GPU, offline fallback only — not the primary path)
  ├─ llama-server  Qwen3-VL-2B        :8185   (label reader fallback, if Gemini is down)
  └─ Ollama        qwen2.5:0.5b       :11434  (structurer fallback, if Groq is down)
                   llama3.2:3b               (duration fallback, if Groq + Gemini are down)
```

### Tech stack
- **Framework:** Next.js 16 (App Router, standalone output) · React 19 · TypeScript
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth v5 (Google) + MongoDB adapter
- **Database:** MongoDB + Mongoose
- **Label reader (pixels → text):** Gemini flash → local Qwen3-VL-2B (GPU, llama.cpp) → PP-OCRv5 (CPU sidecar)
- **Label structurer (text → brand/name):** Groq (`llama-3.3-70b`/`gpt-oss-120b`, free tier) → local `qwen2.5:0.5b` fallback
- **Duration/category AI:** Groq (text) → Google Gemini → local `llama3.2:3b` → heuristic
- **Deploy:** Docker (multi-stage, non-root) + docker compose; Cloudflare Tunnel

The local GPU models exist so the app **degrades to fully offline/free**
if Gemini or Groq are unset, rate-limited, or down — not because they're the
default path. With `GEMINI_API_KEY` and `GROQ_API_KEY` set, every scan and
prediction is a cloud API call; local models only fire on a cloud miss.

---

## Getting started (local dev)

**Prerequisites:** Node.js 20+, MongoDB (local Docker or Atlas), a Google OAuth client.
The AI/OCR models are all optional — the app degrades gracefully without them.

```bash
# 1. Configure — see ENV_SETUP.md for the full list
#    set AUTH_SECRET, Google OAuth, MONGODB_URI in .env.local

# 2. (optional) start a local MongoDB
docker compose up -d mongodb

# 3. Install & run
npm install
npm run dev
```

Open <http://localhost:3000>. The camera works on `localhost` (a secure context) with no
HTTPS cert. In development a **Test Account** login is available (no Google needed);
it's disabled automatically when `NODE_ENV=production`.

Generate `AUTH_SECRET` with `npx auth secret`. For Google OAuth, add
`http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

### (Optional) the local fallback models

Only needed for offline use, or as a safety net if `GEMINI_API_KEY` /
`GROQ_API_KEY` are unset, rate-limited, or down — they're not on the default
path when those keys are set.

```bash
# Structurer fallback — one pull
ollama pull qwen2.5:0.5b

# Reader fallback — Qwen3-VL-2B (Q4) on llama.cpp (GPU). See scripts/start-vision-ocr.ps1
#   run:   llama-server -m qwen3vl.gguf --mmproj qwen3vl-mmproj.gguf -ngl 99 --host 0.0.0.0 --port 8185
```

Set `VISION_OCR_URL` / `OLLAMA_STRUCT_MODEL` to point at them. If unset or unreachable
(and Gemini/Groq are also unset or down), the app falls back to the PP-OCRv5 sidecar
and the `parseLabel` heuristics.

---

## Deploy with Docker

```bash
# set AUTH_SECRET, Google OAuth, GEMINI_API_KEY, etc. in .env  (see ENV_SETUP.md)
docker compose up -d --build                       # app + PP-OCRv5 sidecar + mongodb
docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml up -d --build
                                                   # + Cloudflare Tunnel (public HTTPS, no open ports)
```

- Multi-stage, **non-root** standalone build with a container `HEALTHCHECK` on `/api/health`.
- Secrets via `.env`; the app waits for MongoDB to be **healthy** before starting.
- Host GPU services (Qwen3-VL-2B `llama-server`, Ollama) are reached over
  `host.docker.internal`. Bind `llama-server` to `0.0.0.0` so the container can reach it.
  Both are fallback-only — set `GEMINI_API_KEY` + `GROQ_API_KEY` and they're never called.
- User uploads (`public/uploads`) persist via the `gma_uploads` volume. For multi-instance
  deploys, switch to object storage (S3/R2).

Helper scripts: `npm run docker:up` · `docker:dev` · `docker:down` · `docker:build`.

---

## Configuration

See [`ENV_SETUP.md`](ENV_SETUP.md) for the full, documented list. Essentials:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `AUTH_SECRET` | ✅ | NextAuth signing secret (`npx auth secret`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | prod | Google OAuth |
| `GEMINI_API_KEY` | optional | **Primary** label reader (front/back); also the duration/category fallback if Groq is unavailable |
| `GROQ_API_KEY` / `GROQ_MODEL` | optional | **Primary** structurer + duration/category predictor (default model `openai/gpt-oss-120b`) |
| `VISION_OCR_URL` | optional | Local Qwen3-VL-2B `llama-server`, used only if Gemini is unset/down (e.g. `http://host.docker.internal:8185`); empty → PP-OCRv5 only |
| `OCR_URL` | optional | PP-OCRv5 sidecar, last-resort reader fallback (default `http://ocr:4000`) |
| `OLLAMA_URL` | optional | Ollama host (default `http://host.docker.internal:11434`) |
| `OLLAMA_STRUCT_MODEL` / `LABEL_LLM_ENABLED` | optional | Structurer fallback if Groq is unavailable (default `qwen2.5:1.5b`) |
| `OLLAMA_MODEL` / `LOCAL_LLM_ENABLED` | optional | Duration-prediction fallback if Groq + Gemini are unavailable (`llama3.2:3b`) |
| `ADMIN_SECRET` | optional | Enables `/api/admin/*`; routes 404 without it |

Boot-time validation (`instrumentation.ts`) fails fast if a required variable is missing
in production.

---

## API overview

| Route | Method | Purpose |
|---|---|---|
| `/api/product-vision` | POST | Read a label photo → `{brand, name, flavor, quantity, price}` |
| `/api/predict` | POST | Duration + category for the confirm form |
| `/api/inventory` | GET/POST/DELETE/PATCH | List / add (de-dupes) / remove / adjust qty |
| `/api/shopping-list` | GET/POST/PATCH/DELETE | List / add manual item / check-off-buy-dismiss / remove |
| `/api/analytics` | GET | Time-weighted run-out forecasts |
| `/api/history` | GET/POST | Consumption logs and surveys |
| `/api/user` | GET/PUT | Household settings (family size, survey pref, tour) |
| `/api/demo` | POST/DELETE | Seed / clear onboarding data |
| `/api/health` | GET | DB-aware readiness probe (`?deep=1` also pings the AI providers, admin-gated) |

**Admin** (require `x-admin-secret` matching `ADMIN_SECRET`; 404 if unset): `reset`,
`refresh-durations`, `backfill-rates`, `debug-gemini`.

---

## Project structure

```
app/
  api/            route handlers (see API overview)
  scan/           photo → read → confirm, or manual-add (also serves shopping-list's "Add item")
  inventory/      shelf-grouped grid + consumption survey
  shopping/       low/out-of-stock reminders + manual items
  analytics/ history/ settings/ login/
  page.tsx        landing + run-low hero carousel
components/        PhotoCapture, ProductCard, HeroCard, ShoppingTile, Tour, UserMenu
lib/
  visionOcr.ts     Gemini flash reader → local Qwen3-VL-2B fallback (llama-server)
  parseLabel.ts    text → fields (flavor dictionary, MRP scorer, marketing filter)
  labelStructure.ts Groq structurer → local qwen2.5:0.5b fallback (brand/name)
  depletion.ts     time-weighted stock depletion
  forecast.ts      buildForecasts / isLow (shared by analytics + shopping-list)
  gemini.ts        duration/category ladder
  localLlm.ts      Ollama llama3.2 + web_search tool
  models.ts        Mongoose schemas
  mongodb.ts       Mongoose connection (cached)
ocr/               PP-OCRv5 sidecar (CPU OCR fallback)
scripts/           sims & tests (sim-parselabel, sim-depletion, chain-vision, compare-structure)
auth.ts · middleware.ts · instrumentation.ts
Dockerfile · docker-compose.yml · docker-compose.cloudflare.yml
```

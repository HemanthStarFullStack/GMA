# GMA — Grocery Management Application

Snap a photo of a product, and GMA tells you **when you'll run out**. It reads the
label, files the item onto the right shelf, learns how fast your household actually
goes through it, and projects run-out dates so you restock at the right moment —
no spreadsheets, no guesswork.

Built to work on **no budget**: every reader and model runs **locally and free**,
with graceful fallbacks at every layer so a scan never hard-fails.

> Live: [gma.hemanthify.in](https://gma.hemanthify.in)

---

## What it does

1. **Snap a product.** GMA reads the label — brand, product, flavor, size, price —
   and pre-fills an editable form. A second shot of the back panel pulls net
   quantity + MRP that the front doesn't carry.
2. **Track your pantry.** Items group into shelves (Staples, Fresh, Snacks, Drinks,
   Frozen, Condiments, Household, Other) with a per-item stock bar.
3. **Log consumption** when you finish something. A short survey captures how long
   it really lasted, which sharpens future predictions.
4. **See run-out forecasts** — analytics turns your stock + habits into "restock by"
   dates, most-urgent first.

A guided tour seeds a sample household on first login; clear it anytime from Settings.

---

## Why photo + OCR (and not barcode lookup)

There is **no free barcode database with good Indian-FMCG coverage** — the open ones
(OpenFoodFacts/OpenBeautyFacts) miss most Indian packs, and paid APIs cost money. So
GMA reads the **label itself**, which works for *any* product on day one. A barcode,
when present, is still used as a stable cache key — but the label is the source of truth.

The **shared catalogue is the real database**: the first time anyone resolves a product
it's cached (keyed by barcode/identity), so every later scan of that product — by any
user — is instant and free. Over time the cache becomes a catalogue of exactly the
things people here actually buy.

---

## How label reading works

Two independent layers, each with a fallback, so a scan **never dead-ends**:

```
            ┌──────────────── READ (pixels → text) ─────────────────┐
photo  ───► PaddleOCR-VL (0.9B VLM, GPU via llama.cpp)               │
            └─ fallback: PP-OCRv5 sidecar (CPU container)            │
                                   │ clean text                      │
            ┌──────────── STRUCTURE (text → fields) ────────────────┤
            ► qwen2.5:0.5b  →  brand + name (world knowledge)        │
            └─ fallback: parseLabel heuristics                       │
                                   │                                 │
            flavor  ← parseLabel dictionary (reliable)               │
            size / price / back-panel  ← deterministic regex         │
                                   ▼                                 │
                         editable confirm form  ◄────────────────────┘
```

**Why each layer is split this way** — they play to different strengths:

- **PaddleOCR-VL** (Baidu, 0.9B) reads dense/stylised labels far more cleanly than the
  PP-OCRv5 OCR engine (e.g. it reads `NO ADDED SUGAR`, not a garbled `NO SER`). Runs on
  the host GPU via `llama-server` (llama.cpp). If it's down, the CPU PP-OCRv5 sidecar
  takes over.
- **qwen2.5:0.5b** makes the call regex can't: *"is `SWING` a brand or a product name?"*
  A model with world knowledge knows. It owns **brand + name**.
- **`parseLabel`** owns **flavor** (a curated dictionary — `Pomegranate`, `Mixed Fruit`,
  `Pink Lily`…), and the small LLM only fills flavor when the dictionary finds nothing.
- **Regex** owns **price, net quantity, and back-panel detection** — deterministic, so a
  model can never hallucinate a price. The MRP extractor scores candidates by context to
  avoid grabbing a batch number or an RDA percentage instead of the real price.

Every layer is **fail-soft**: if the GPU model or LLM is unavailable, the next layer
covers it, down to a plain heuristic + a manual form. The whole result is logged
(`[vision] {...}`) so any misread is debuggable from `docker logs`.

---

## How consumption + category prediction works

For a newly-seen product, GMA estimates **how long one unit lasts (for one person)** and
**which category** it is, via a fallback ladder:

```
Gemini 2.5 flash-lite  →  Gemini 2.5 flash  →  local Ollama (llama3.2:3b)  →  heuristic
   (primary)              (separate quota)       (offline backup)             (14d / "Other")
```

- The prompt makes the model **reason about pack size** (`unitSize → servings → dailyUse
  → averageDuration`), so 330 ml, 1 L and 2 L of the same drink get different shelf-lives.
- A `perPersonDailyRate` is stored so re-estimating for a different household is pure
  math — no AI call.
- **Self-healing cache:** a product cached during an outage (heuristic fallback) is
  flagged `aiPredicted: false` and re-predicted on its next scan, fixing it for everyone.

> Note: the duration/category LLM (Gemini, or `llama3.2` as fallback) is **separate** from
> the label-reading models. Label reading never uses Gemini — it's fully local.

---

## How run-out forecasting works

Forecasting is **time-weighted over household size**, not a flat rate:

- Each item's consumption is integrated over how the household size actually varied across
  its life (a guest for a few days, a permanent move-in), then the remainder is projected
  forward at the current size. A guest's extra consumption is captured and **persists after
  they leave**; a permanent move **doesn't retroactively rewrite** past usage.
- Household-size changes re-estimate every held product from the fixed `perPersonDailyRate`
  (not by rescaling a rounded value), so repeated changes don't drift.
- Personal-care items are per-person and aren't scaled by household size.

Consumption surveys feed the learned `averageDuration` back in, so estimates sharpen over time.

---

## Architecture

```
Browser (Next.js App Router · React 19)
  │  camera → photo
  ▼
Route handlers (app/api/*)
  ├─ /product-vision  read label: PaddleOCR-VL → PP-OCRv5, then LLM-structure
  ├─ /barcode         cache → OpenFoodFacts → OpenBeautyFacts → manual
  ├─ /predict         duration/category for the confirm form
  ├─ /inventory       add/list/delete; de-dupes by incrementing rows
  ├─ /analytics       time-weighted depletion → run-out forecasts
  ├─ /history /user /demo /health
  │
  ├─ lib/visionOcr.ts      PaddleOCR-VL client (llama-server, OpenAI API)
  ├─ lib/parseLabel.ts     text → fields heuristics (flavor dict, MRP scorer)
  ├─ lib/labelStructure.ts qwen2.5:0.5b structurer (brand/name)
  ├─ lib/depletion.ts      time-weighted stock depletion
  ├─ lib/gemini.ts         duration/category ladder
  ├─ lib/localLlm.ts       Ollama llama3.2 + web_search tool
  └─ lib/mongodb.ts        Mongoose connection (cached)
  ▼
MongoDB · Users · Products (shared catalogue/cache) · Inventory · ConsumptionLog

Host services (GPU, free, local)
  ├─ llama-server  PaddleOCR-VL 0.9B  :8185   (label reader)
  └─ Ollama        qwen2.5:0.5b       :11434  (label structurer)
                   llama3.2:3b               (duration fallback)
```

### Tech stack
- **Framework:** Next.js 16 (App Router, standalone output) · React 19 · TypeScript
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth v5 (Google) + MongoDB adapter
- **Database:** MongoDB + Mongoose
- **Label reader:** PaddleOCR-VL 0.9B (GPU, via llama.cpp `llama-server`) + PP-OCRv5 (CPU sidecar)
- **Label structurer:** qwen2.5:0.5b (Ollama)
- **Duration/category AI:** Google Gemini → local `llama3.2:3b` → heuristic
- **Deploy:** Docker (multi-stage, non-root) + docker compose; Cloudflare Tunnel

Everything model-related runs **locally on a 4 GB GPU** (PaddleOCR-VL ~1.8 GB +
qwen2.5:0.5b ~0.5 GB co-reside) — no per-scan API cost.

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

### (Optional) the local label models

```bash
# Structurer — one pull
ollama pull qwen2.5:0.5b

# Reader — PaddleOCR-VL on llama.cpp (GPU). See scripts/start-vision-ocr.ps1
#   model: PaddlePaddle/PaddleOCR-VL-1.6-GGUF  (+ its -mmproj.gguf)
#   run:   llama-server -m model.gguf --mmproj mmproj.gguf -ngl 99 --host 0.0.0.0 --port 8185
```

Set `VISION_OCR_URL` / `OLLAMA_STRUCT_MODEL` to point at them. If unset or unreachable,
the app falls back to the PP-OCRv5 sidecar and the `parseLabel` heuristics.

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
- Host GPU services (PaddleOCR-VL `llama-server`, Ollama) are reached over
  `host.docker.internal`. Bind `llama-server` to `0.0.0.0` so the container can reach it.
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
| `VISION_OCR_URL` | optional | PaddleOCR-VL `llama-server` (e.g. `http://host.docker.internal:8185`); empty → PP-OCRv5 only |
| `OCR_URL` | optional | PP-OCRv5 sidecar (default `http://ocr:4000`) |
| `OLLAMA_URL` | optional | Ollama host (default `http://host.docker.internal:11434`) |
| `OLLAMA_STRUCT_MODEL` / `LABEL_LLM_ENABLED` | optional | Label structurer (default `qwen2.5:1.5b`) |
| `OLLAMA_MODEL` / `LOCAL_LLM_ENABLED` | optional | Duration-prediction LLM fallback (`llama3.2:3b`) |
| `GEMINI_API_KEY` | optional | Primary duration/category predictor |
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
| `/api/analytics` | GET | Time-weighted run-out forecasts |
| `/api/history` | GET/POST | Consumption logs and surveys |
| `/api/user` | GET/PUT | Household settings (family size, survey pref, tour) |
| `/api/demo` | POST/DELETE | Seed / clear onboarding data |
| `/api/health` | GET | DB-aware readiness probe |

**Admin** (require `x-admin-secret` matching `ADMIN_SECRET`; 404 if unset): `reset`,
`refresh-durations`, `backfill-rates`, `debug-gemini`.

---

## Project structure

```
app/
  api/            route handlers (see API overview)
  scan/           photo → read → confirm, or manual-add
  inventory/      shelf-grouped grid + consumption survey
  analytics/ history/ settings/ login/
  page.tsx        landing + run-low hero carousel
components/        PhotoCapture, ProductCard, HeroCard, ProductSurvey, Tour, UserMenu
lib/
  visionOcr.ts     PaddleOCR-VL client (llama-server)
  parseLabel.ts    text → fields (flavor dictionary, MRP scorer, marketing filter)
  labelStructure.ts qwen2.5:0.5b structurer (brand/name)
  depletion.ts     time-weighted stock depletion
  gemini.ts        duration/category ladder
  localLlm.ts      Ollama llama3.2 + web_search tool
  models.ts        Mongoose schemas
  mongodb.ts       Mongoose connection (cached)
ocr/               PP-OCRv5 sidecar (CPU OCR fallback)
scripts/           sims & tests (sim-parselabel, sim-depletion, chain-vision, compare-structure)
auth.ts · middleware.ts · instrumentation.ts
Dockerfile · docker-compose.yml · docker-compose.cloudflare.yml
```

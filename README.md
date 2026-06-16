# SINTI — Smart Inventory Tracking

Scan your groceries, track what's in your household, and get warned **before you run out**.
SINTI learns how fast you consume each product and predicts its run-out date from your
own consumption rhythm — no manual spreadsheets, no guesswork.

> **Note:** This is a portfolio project. It is intentionally **AI-free** — every feature
> runs on deterministic logic and free public APIs, so it is reliable and costs nothing
> to operate.

## Features

- **Reliable barcode scanning** — continuous video decoding (ZXing) tuned for retail
  formats (EAN-13/8, UPC-A/E, Code-128/39).
- **Multi-source product lookup that never dead-ends:**
  1. Local cache (self-learning — any product anyone adds resolves instantly next time)
  2. [UPCitemDB](https://www.upcitemdb.com/) (broad coverage)
  3. [OpenFoodFacts](https://world.openfoodfacts.org/) (groceries + product images)
  4. 5-second manual add when a product isn't in any database — saved forever after
- **Consumption logging & surveys** with simple anomaly flags.
- **Run-out predictions** — rhythm-based: learns an average duration per product, derives
  a consumption rate, and projects days-until-empty against current stock.
- **Demo onboarding** — a sample household is seeded on first login so the dashboard is
  alive immediately; clear it anytime from Settings.

## Tech Stack

- **Framework:** Next.js 16 (App Router) · React 19 · TypeScript
- **Styling:** Tailwind CSS v4
- **Auth:** NextAuth v5 (Google) with the MongoDB adapter
- **Database:** MongoDB + Mongoose
- **Barcode:** `@zxing/browser` + `@zxing/library`

## Getting Started

### 1. Prerequisites
- Node.js 20+
- A MongoDB instance (local Docker via `docker-compose.yml`, or MongoDB Atlas)
- A Google OAuth client ID/secret ([Google Cloud Console](https://console.cloud.google.com/apis/credentials))

### 2. Environment
Create `.env.local` in the project root (see `ENV_SETUP.md`):

```env
MONGODB_URI=mongodb://admin:sinti_password_2024@localhost:27017/sinti_v2?authSource=admin
AUTH_SECRET=run `npx auth secret` to generate
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

For Google OAuth, add `http://localhost:3000/api/auth/callback/google` as an authorized
redirect URI.

### 3. Run

```bash
# (optional) start a local MongoDB
docker compose up -d

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The camera works on `localhost`
because it's a secure context — no HTTPS certificate needed for local development.

## Project Structure

```
app/
  api/
    barcode/      # cache -> UPCitemDB -> OpenFoodFacts lookup
    inventory/    # add/list/delete items (caches products by barcode)
    analytics/    # consumption history + run-out predictions
    history/      # consumption logs
    user/         # household settings (family size, survey pref)
    demo/         # seed / clear onboarding data
  scan/           # scan -> confirm or manual-add flow
  inventory/      # inventory grid + consumption survey
  analytics/ history/ settings/ login/
components/        # BarcodeScanner, ProductCard, ProductSurvey, UserMenu
lib/              # mongodb connection + Mongoose models
```

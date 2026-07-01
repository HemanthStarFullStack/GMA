# Environment Setup

All configuration is via environment variables. Copy the template and fill it in
(`.env*` is gitignored — never commit real secrets):

```bash
cp .env.example .env        # for docker compose
cp .env.example .env.local  # for `npm run dev`
```

See [`.env.example`](.env.example) for the full, documented list. The essentials:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | ✅ | MongoDB connection string (Atlas or the compose `mongodb` service) |
| `AUTH_SECRET` | ✅ | NextAuth signing secret — `npx auth secret` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | prod | Google OAuth sign-in |
| `GROQ_API_KEY` / `GROQ_MODEL` | optional | **Primary** structurer + duration/category predictor (default model `openai/gpt-oss-120b`) |
| `GEMINI_API_KEY` | optional | Duration/category fallback if Groq is unavailable; then local LLM → heuristic |
| `OLLAMA_URL` / `OLLAMA_MODEL` | optional | Local LLM fallback if Groq + Gemini are unavailable. `LOCAL_LLM_ENABLED=false` to disable |
| `ADMIN_SECRET` | optional | Enables `/api/admin/*`; routes return 404 if unset |

In development a **Test Account** credentials provider is available (no Google needed);
it is automatically disabled when `NODE_ENV=production`.

## Running with Docker

```bash
cp .env.example .env        # then edit AUTH_SECRET etc.
docker compose up -d --build         # app + mongodb
docker compose --profile dev up -d   # also start mongo-express on :8081
```

The app serves on http://localhost:3000 and exposes a health probe at
`/api/health`. The local-LLM fallback expects Ollama on the host
(`http://host.docker.internal:11434`); set `LOCAL_LLM_ENABLED=false` to skip it.

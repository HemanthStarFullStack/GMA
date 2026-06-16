# Environment Setup

Create a file named `.env.local` in the project root with the following variables.
(`.env*` is gitignored — never commit real secrets.)

```env
# --- MongoDB ---------------------------------------------------------------
# Local Docker (see docker-compose.yml) or a MongoDB Atlas connection string.
MONGODB_URI=mongodb://admin:sinti_password_2024@localhost:27017/sinti_v2?authSource=admin

# --- NextAuth --------------------------------------------------------------
# Generate one with:  npx auth secret
AUTH_SECRET=replace_with_generated_secret

# --- Google OAuth ----------------------------------------------------------
# Create credentials at https://console.cloud.google.com/apis/credentials
# Authorized redirect URI:  http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

No AI / vision API keys are required — the app is intentionally AI-free.

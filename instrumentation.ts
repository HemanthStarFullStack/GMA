// Next.js runs register() once when the server process starts.
// We use it to fail fast on misconfiguration in production rather than
// discovering a missing secret on the first request.
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const required = ['MONGODB_URI', 'AUTH_SECRET'];
    const missing = required.filter((k) => !process.env[k]);

    if (process.env.NODE_ENV === 'production') {
        if (missing.length) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
            console.warn('⚠️  Google OAuth is not configured — sign-in will be unavailable.');
        }
        if (!process.env.GEMINI_API_KEY) {
            console.warn('⚠️  GEMINI_API_KEY not set — predictions rely on the local LLM / heuristic only.');
        }
    } else if (missing.length) {
        console.warn(`⚠️  Missing env vars (dev): ${missing.join(', ')}`);
    }
}

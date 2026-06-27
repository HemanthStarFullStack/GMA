
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import type { NextAuthConfig } from "next-auth"

const devProviders = process.env.NODE_ENV !== "production"
    ? [
        Credentials({
            id: "test",
            name: "Test Account",
            credentials: {},
            authorize() {
                return { id: "test-user-id", name: "Test User", email: "test@sinti.local" }
            },
        }),
    ]
    : []

export default {
    providers: [
        ...devProviders,
        Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
        }),
    ],
    callbacks: {
        async session({ session, token }) {
            if (session.user) {
                if (token.sub) session.user.id = token.sub;
                if (typeof token.name === "string") session.user.name = token.name;
                if (typeof token.picture === "string") session.user.image = token.picture;
            }
            return session;
        },
        // `trigger: "update"` lets the settings page push a new name/photo into the
        // JWT (via useSession().update) so the change shows immediately, no re-login.
        async jwt({ token, user, trigger, session }) {
            if (user) {
                token.sub = user.id;
                token.name = user.name ?? token.name;
                token.picture = (user as { image?: string }).image ?? token.picture;
            }
            if (trigger === "update" && session) {
                const s = session as { name?: string; image?: string };
                if (typeof s.name === "string") token.name = s.name;
                if (typeof s.image === "string") token.picture = s.image;
            }
            return token;
        },
    },
    pages: {
        signIn: '/login',
    }
} satisfies NextAuthConfig

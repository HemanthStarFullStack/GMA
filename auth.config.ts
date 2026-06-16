
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
            if (session.user && token.sub) {
                session.user.id = token.sub;
            }
            return session;
        },
        async jwt({ token, user }) {
            if (user) {
                token.sub = user.id;
            }
            return token;
        }
    },
    pages: {
        signIn: '/login',
    }
} satisfies NextAuthConfig

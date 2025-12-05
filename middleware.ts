import NextAuth from "next-auth"
import authConfig from "./auth.config"
import { NextResponse } from "next/server"

const { auth } = NextAuth(authConfig)

export default auth((req) => {
    const isLoggedIn = !!req.auth
    const isOnDashboard = req.nextUrl.pathname.startsWith('/inventory') ||
        req.nextUrl.pathname.startsWith('/scan') ||
        req.nextUrl.pathname.startsWith('/history')

    if (isOnDashboard) {
        if (isLoggedIn) return
        return NextResponse.redirect(new URL('/login', req.nextUrl))
    } else if (isLoggedIn && req.nextUrl.pathname === '/login') {
        return NextResponse.redirect(new URL('/scan', req.nextUrl))
    }
    return
})

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}

import { signIn } from "@/auth"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

const isDev = process.env.NODE_ENV !== "production"

export default function LoginPage() {
    return (
        <div className="min-h-screen flex flex-col">
            <header className="container mx-auto px-5 py-6">
                <Link href="/" className="inline-flex items-center gap-2 text-ink-soft hover:text-ink">
                    <ArrowLeft className="w-5 h-5" />
                    <span className="font-medium">Back</span>
                </Link>
            </header>

            <div className="flex-1 flex items-center justify-center px-5 pb-20">
                <div className="w-full max-w-md rise">
                    <div className="text-center mb-8">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo.png" alt="GMA" className="h-10 w-auto mx-auto" />
                        <p className="kicker mt-3">Grocery management</p>
                    </div>

                    <div className="pantry-card p-8">
                        <h1 className="font-display text-3xl font-semibold text-ink text-center leading-tight">
                            Welcome to your kitchen, organised.
                        </h1>
                        <p className="text-center text-ink-soft mt-3 mb-8">
                            Sign in to scan products, track inventory and get restock forecasts.
                        </p>

                        <form
                            action={async () => {
                                "use server"
                                await signIn("google", { redirectTo: "/inventory" })
                            }}
                        >
                            <button
                                type="submit"
                                className="w-full flex items-center justify-center gap-3 rounded-full border border-line-strong bg-card px-4 py-3.5 text-sm font-semibold text-ink hover:bg-paper-2 transition-colors"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Continue with Google
                            </button>
                        </form>

                        {isDev && (
                            <form
                                action={async () => {
                                    "use server"
                                    await signIn("test", { redirectTo: "/inventory" })
                                }}
                                className="mt-3"
                            >
                                <button
                                    type="submit"
                                    className="w-full flex items-center justify-center gap-2 rounded-full border border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                                >
                                    🧪 Dev: Sign in as Test User
                                </button>
                            </form>
                        )}
                    </div>

                    <p className="text-center text-xs text-ink-faint mt-6">
                        A sample household is loaded on your first visit so you can explore right away.
                    </p>
                </div>
            </div>
        </div>
    )
}

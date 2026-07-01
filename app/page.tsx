import Link from "next/link";
import { Camera, Package, History, Settings, BarChart3, ArrowRight } from "lucide-react";
import { auth } from "@/auth";
import UserMenu from "@/components/UserMenu";
import HeroCard, { type HeroItem } from "@/components/HeroCard";
import { buildForecasts } from "@/lib/forecast";
import ShoppingTile from "@/components/ShoppingTile";

export default async function HomePage() {
    const session = await auth();

    let heroItems: HeroItem[] = [];

    if (session?.user?.id) {
        const userId = session.user.id;
        try {
            const forecasts = await buildForecasts(userId);

            // Hero carousel: in-stock products sorted most-urgent first.
            // Uses the same blended avgDuration that Analytics shows — no divergence.
            heroItems = forecasts
                .filter((f) => f.status === "in_stock" && f.predictions !== null)
                .map((f) => ({
                    name: f.name,
                    brand: f.brand,
                    quantity: f.currentStock,
                    unit: f.unit,
                    daysLeft: Math.max(0, Math.round(f.predictions!.daysUntilEmpty)),
                }))
                .sort((a, b) => a.daysLeft - b.daysLeft)
                .slice(0, 5);

        } catch {
            // keep defaults — never 500 the landing page
        }
    }

    const isGuest = !session?.user;

    const tiles = [
        { href: "/inventory", label: "Inventory", note: "What you have",     Icon: Package,  tint: "text-olive" },
        { href: "/analytics", label: "Analytics", note: "Run-out forecasts", Icon: BarChart3, tint: "text-terracotta" },
        { href: "/history",   label: "History",   note: "What you've used",  Icon: History,  tint: "text-berry" },
        { href: "/settings",  label: "Settings",  note: "Household & prefs",  Icon: Settings, tint: "text-amber" },
    ];

    return (
        <div className="min-h-dvh flex flex-col">
            <header className="container mx-auto px-5 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-baseline gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo.png" alt="GMA" className="h-7 w-auto" />
                    <span className="hidden sm:inline text-xs text-ink-faint">· grocery management</span>
                </div>
                {session ? (
                    <UserMenu />
                ) : (
                    <Link href="/login" className="btn-ghost px-4 py-2 text-sm">Sign in</Link>
                )}
            </header>

            <main className="flex-1 container mx-auto px-5 flex flex-col py-6 gap-8 md:gap-10 md:py-8 lg:gap-12 lg:py-10">
                {/* Two-column, fit-to-screen from md (iPad portrait) up — below md
                    it stacks for phones. Was gated at lg, so tablets got the tall
                    phone layout and scrolled. */}
                <section data-tour="hero" className="grid md:grid-cols-12 gap-6 items-start md:items-center md:flex-1">
                    <div className="md:col-span-7 rise">
                        <p className="kicker mb-2">Know your kitchen</p>
                        <h1 className="font-display text-ink text-4xl sm:text-5xl lg:text-6xl font-semibold leading-[0.98]">
                            Restock <span className="italic text-primary">before</span> you run&nbsp;out.
                        </h1>
                        <p className="mt-4 text-base text-ink-soft max-w-xl">
                            Scan your groceries, track what's in the house, and let GMA learn your rhythm —
                            so you know what's running low before the shelf is empty.
                        </p>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            <Link
                                href={session ? "/scan" : "/login"}
                                className="btn-primary px-5 py-3 inline-flex items-center gap-2 text-base shadow-lg"
                            >
                                <Camera className="w-5 h-5" />
                                {session ? "Scan a product" : "Get started"}
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                        </div>
                    </div>

                    <div className="md:col-span-5 rise" style={{ animationDelay: "120ms" }}>
                        <HeroCard items={heroItems} isGuest={isGuest} />
                    </div>
                </section>

                <section className="pb-2 space-y-3">
                    <ShoppingTile />

                    <div data-tour="home-tiles" className="grid grid-cols-2 gap-3">
                        {tiles.map(({ href, label, note, Icon, tint }, i) => (
                            <Link
                                key={href}
                                href={href}
                                className="pantry-card p-4 group hover:-translate-y-0.5 transition-transform rise"
                                style={{ animationDelay: `${180 + i * 60}ms` }}
                            >
                                <Icon className={`w-6 h-6 ${tint}`} strokeWidth={1.6} />
                                <h3 className="font-display text-lg font-semibold text-ink mt-2">{label}</h3>
                                <p className="text-xs text-ink-soft">{note}</p>
                            </Link>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="border-t border-line shrink-0">
                <div className="container mx-auto px-5 py-3 text-sm text-ink-faint flex items-center justify-center gap-2">
                    <span className="font-display italic">Scan · track · restock</span>
                </div>
            </footer>
        </div>
    );
}

import Link from "next/link";
import { Camera, Package, History, Settings, BarChart3, ArrowRight } from "lucide-react";
import { auth } from "@/auth";
import UserMenu from "@/components/UserMenu";
import HeroCard, { type HeroItem } from "@/components/HeroCard";
import connectDB from "@/lib/mongodb";
import { Inventory, Product } from "@/lib/models";

async function getHeroItems(userId: string): Promise<HeroItem[]> {
    await connectDB();

    const invItems = await Inventory.find({ userId, status: "active" })
        .sort({ quantity: 1 })
        .limit(8)
        .lean();

    if (invItems.length === 0) return [];

    const barcodes = invItems.map((i) => i.productId);
    const products = await Product.find({ barcode: { $in: barcodes } }).lean();
    const prodMap = new Map(products.map((p) => [p.barcode, p]));

    const now = Date.now();
    const items: HeroItem[] = invItems.map((item) => {
        const prod = prodMap.get(item.productId);
        const daysSince = Math.floor((now - new Date(item.purchaseDate).getTime()) / 86_400_000);
        const totalDays = item.quantity * (prod?.averageDuration ?? 14);
        const daysLeft = Math.max(0, totalDays - daysSince);
        return {
            name: prod?.name ?? "Unknown Product",
            brand: prod?.brand ?? "",
            quantity: item.quantity,
            unit: item.unit,
            daysLeft,
        };
    });

    // Most urgent first; cap at 5 for the carousel
    return items.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 5);
}

export default async function HomePage() {
    const session = await auth();

    const heroItems = session?.user?.id ? await getHeroItems(session.user.id) : [];
    const isGuest = !session?.user;

    const tiles = [
        { href: "/inventory", label: "Inventory", note: "What you have",     Icon: Package,  tint: "text-olive" },
        { href: "/analytics", label: "Analytics", note: "Run-out forecasts", Icon: BarChart3, tint: "text-terracotta" },
        { href: "/history",   label: "History",   note: "What you've used",  Icon: History,  tint: "text-berry" },
        { href: "/settings",  label: "Settings",  note: "Household & prefs",  Icon: Settings, tint: "text-amber" },
    ];

    return (
        <div className="min-h-screen">
            <header className="container mx-auto px-5 py-6 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                    <span className="font-display text-2xl font-semibold text-ink tracking-tight">GMA</span>
                    <span className="hidden sm:inline text-xs text-ink-faint">· grocery management</span>
                </div>
                {session ? (
                    <UserMenu />
                ) : (
                    <Link href="/login" className="btn-ghost px-4 py-2 text-sm">Sign in</Link>
                )}
            </header>

            <main className="container mx-auto px-5">
                <section className="pt-10 pb-14 grid lg:grid-cols-12 gap-10 items-center">
                    <div className="lg:col-span-7 rise">
                        <p className="kicker mb-4">Know your kitchen</p>
                        <h1 className="font-display text-ink text-5xl sm:text-6xl lg:text-7xl font-semibold leading-[0.98]">
                            Restock <span className="italic text-primary">before</span> you run&nbsp;out.
                        </h1>
                        <p className="mt-6 text-lg text-ink-soft max-w-xl">
                            Scan your groceries, track what's in the house, and let GMA learn your rhythm —
                            so you know what's running low before the shelf is empty.
                        </p>

                        <div className="mt-8 flex flex-wrap items-center gap-3">
                            <Link
                                href={session ? "/scan" : "/login"}
                                className="btn-primary px-6 py-3.5 inline-flex items-center gap-2 text-base shadow-lg"
                            >
                                <Camera className="w-5 h-5" />
                                {session ? "Scan a product" : "Get started"}
                                <ArrowRight className="w-4 h-4" />
                            </Link>
                            <Link href="/inventory" className="btn-ghost px-6 py-3.5 inline-flex items-center gap-2 text-base">
                                View inventory
                            </Link>
                        </div>
                    </div>

                    <div className="lg:col-span-5 rise" style={{ animationDelay: "120ms" }}>
                        <HeroCard items={heroItems} isGuest={isGuest} />
                    </div>
                </section>

                <section className="pb-20">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {tiles.map(({ href, label, note, Icon, tint }, i) => (
                            <Link
                                key={href}
                                href={href}
                                className="pantry-card p-6 group hover:-translate-y-0.5 transition-transform rise"
                                style={{ animationDelay: `${180 + i * 60}ms` }}
                            >
                                <Icon className={`w-8 h-8 ${tint}`} strokeWidth={1.6} />
                                <h3 className="font-display text-xl font-semibold text-ink mt-4">{label}</h3>
                                <p className="text-sm text-ink-soft">{note}</p>
                            </Link>
                        ))}
                    </div>
                </section>
            </main>

            <footer className="border-t border-line">
                <div className="container mx-auto px-5 py-6 text-sm text-ink-faint flex items-center justify-center gap-2">
                    <span className="font-display italic">Scan · track · restock</span>
                </div>
            </footer>
        </div>
    );
}

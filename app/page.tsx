import Link from "next/link";
import { Camera, Package, History, Settings, BarChart3, ArrowRight, ShoppingCart } from "lucide-react";
import { auth } from "@/auth";
import UserMenu from "@/components/UserMenu";
import HeroCard, { type HeroItem } from "@/components/HeroCard";
import connectDB from "@/lib/mongodb";
import { Inventory, Product, User } from "@/lib/models";
import { depletion, type SizeSegment } from "@/lib/depletion";
import { lowStockCount } from "@/lib/forecast";

async function getHeroItems(userId: string): Promise<HeroItem[]> {
    await connectDB();

    const invItems = await Inventory.find({ userId, status: "active" })
        .sort({ quantity: 1 })
        .limit(8)
        .lean();

    if (invItems.length === 0) return [];

    const barcodes = invItems.map((i) => i.productId);
    const [products, user] = await Promise.all([
        Product.find({ barcode: { $in: barcodes } }).lean(),
        User.findById(userId).select("familySize familySizeLog").lean(),
    ]);
    const prodMap = new Map(products.map((p) => [p.barcode, p]));
    const currentSize = Math.max(1, user?.familySize ?? 1);
    const sizeLog = (user?.familySizeLog as SizeSegment[] | undefined) ?? [];

    const now = new Date();
    const items: HeroItem[] = invItems.map((item) => {
        const prod = prodMap.get(item.productId);
        const { daysLeft } = depletion({
            purchaseDate: item.purchaseDate,
            qty: item.quantity,
            now,
            perPersonDailyRate: prod?.perPersonDailyRate ?? null,
            averageDuration: prod?.averageDuration ?? 14,
            currentSize,
            isPerPerson: prod?.category === "Personal Care",
            sizeLog,
        });
        return {
            name: prod?.name ?? "Unknown Product",
            brand: prod?.brand ?? "",
            quantity: item.quantity,
            unit: item.unit,
            daysLeft: Math.max(0, Math.round(daysLeft)),
        };
    });

    // Most urgent first; cap at 5 for the carousel
    return items.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 5);
}

export default async function HomePage() {
    const session = await auth();

    const heroItems = session?.user?.id ? await getHeroItems(session.user.id) : [];
    const isGuest = !session?.user;
    const lowCount = session?.user?.id ? await lowStockCount(session.user.id) : 0;

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

            <main className="flex-1 container mx-auto px-5 flex flex-col py-6 gap-8 lg:gap-12 lg:py-10">
                <section className="grid lg:grid-cols-12 gap-6 items-start lg:items-center lg:flex-1">
                    <div className="lg:col-span-7 rise">
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
                            <Link href="/inventory" className="btn-ghost px-5 py-3 inline-flex items-center gap-2 text-base">
                                View inventory
                            </Link>
                        </div>
                    </div>

                    <div className="lg:col-span-5 rise" style={{ animationDelay: "120ms" }}>
                        <HeroCard items={heroItems} isGuest={isGuest} />
                    </div>
                </section>

                <section className="pb-2 space-y-3">
                    {/* Shopping list — doubles as the in-app restock reminder/badge. */}
                    <Link
                        href="/shopping"
                        className={`pantry-card p-4 flex items-center gap-4 group hover:-translate-y-0.5 transition-transform rise ${lowCount > 0 ? "border-terracotta/40 bg-terracotta/[0.04]" : ""}`}
                        style={{ animationDelay: "160ms" }}
                    >
                        <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${lowCount > 0 ? "bg-terracotta/15 text-terracotta" : "bg-paper-2 text-ink-soft"}`}>
                            <ShoppingCart className="w-6 h-6" strokeWidth={1.6} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-display text-lg font-semibold text-ink">Shopping list</h3>
                            <p className="text-xs text-ink-soft">
                                {lowCount > 0
                                    ? `${lowCount} item${lowCount === 1 ? "" : "s"} to restock`
                                    : "What to buy"}
                            </p>
                        </div>
                        {lowCount > 0 && (
                            <span className="pill bg-terracotta text-paper font-semibold">{lowCount}</span>
                        )}
                        <ArrowRight className="w-5 h-5 text-ink-faint group-hover:text-ink transition-colors flex-shrink-0" />
                    </Link>

                    <div className="grid grid-cols-2 gap-3">
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

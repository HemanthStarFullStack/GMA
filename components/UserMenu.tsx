'use client';

import { useSession, signOut } from "next-auth/react";
import { User, LogOut } from "lucide-react";
import { useState } from "react";

export default function UserMenu() {
    const { data: session } = useSession();
    const [isOpen, setIsOpen] = useState(false);

    if (!session?.user) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 p-1 rounded-full hover:bg-paper-2 transition-colors"
                title={session.user.name || "User Profile"}
            >
                {session.user.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="Profile" className="w-10 h-10 rounded-full border border-line bg-card" />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-olive/10 flex items-center justify-center text-olive border border-olive/20">
                        <User className="w-5 h-5" />
                    </div>
                )}
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-52 pantry-card py-1 z-50 overflow-hidden">
                        <div className="px-4 py-3 border-b border-line bg-paper-2/50">
                            <p className="text-sm font-semibold text-ink truncate">{session.user.name}</p>
                            <p className="text-xs text-ink-faint truncate">{session.user.email}</p>
                        </div>
                        <button
                            onClick={() => signOut()}
                            className="w-full text-left px-4 py-2.5 text-sm text-berry hover:bg-berry/5 flex items-center gap-2 transition-colors"
                        >
                            <LogOut className="w-4 h-4" />
                            Sign out
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

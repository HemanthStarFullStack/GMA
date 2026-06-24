'use client';

import { SessionProvider } from "next-auth/react";
import GmaTour from "@/components/Tour";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <GmaTour />
            {children}
        </SessionProvider>
    );
}

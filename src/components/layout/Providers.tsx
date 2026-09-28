"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ToastViewport } from "@/components/ui/Toast";
import { installApiToastInterceptor } from "@/lib/api-client";

// Installed at module evaluation (client only) rather than in an effect, so
// the very first mutation a page makes — even one fired during its own first
// render cycle — already goes through the interceptor. It is idempotent.
if (typeof window !== "undefined") installApiToastInterceptor();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <ToastViewport />
    </SessionProvider>
  );
}

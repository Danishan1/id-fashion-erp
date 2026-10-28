"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/PageStates";

/** Catches an unexpected render error in any Sales & Marketing page so the rest of the ERP shell keeps working. */
export default function SalesMarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Something went wrong in Sales &amp; Marketing</h1>
      <ErrorState message="This page could not be displayed. Your data has not been changed." onRetry={reset} />
    </div>
  );
}

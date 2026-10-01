"use client";

import { useEffect } from "react";
import { CrmErrorState } from "@/components/crm/CrmStates";

/** Catches an unexpected render error in any CRM page so the rest of the ERP shell keeps working. */
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="space-y-2">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Something went wrong in CRM</h1>
      <CrmErrorState message="This page could not be displayed. Your data has not been changed." onRetry={reset} />
    </div>
  );
}

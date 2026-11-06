"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { getApiErrorMessage } from "@/lib/api-client";

/**
 * An order already exists for the accepted revision but the quotation wasn't
 * marked converted (e.g. the browser closed mid-way). Re-posting the
 * conversion is idempotent: it only brings the quotation and enquiry in line.
 */
export function FinishConversionButton({ quotationId }: { quotationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="xs"
        isLoading={busy}
        loadingLabel="Saving…"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/v1/sales-marketing/quotations/${quotationId}/convert`, { method: "POST", headers: { "Content-Type": "application/json", "x-toast": "off" }, body: "{}" });
          setBusy(false);
          if (!res.ok) return setError(await getApiErrorMessage(res));
          router.push(`/sales-marketing/quotations/${quotationId}`);
          router.refresh();
        }}
      >
        Mark quotation as converted
      </Button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

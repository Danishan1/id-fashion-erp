"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * "Generate Barcode" row action for the Products/Materials/Variant lists
 * (Barcode Management & Scanning System, Phase 1, 2026-09-29) — reused
 * as-is by any future list of ITEM/SKU-type entities. `generateItemOrSkuBarcode`
 * is idempotent (see barcode.service.ts), so a second click for an entity
 * that already has a barcode just returns/displays the same code rather than
 * erroring — this button never needs to know in advance whether one exists.
 */
interface GenerateBarcodeButtonProps {
  entityType: "ITEM" | "SKU";
  entityId: string;
}

export function GenerateBarcodeButton({ entityType, entityId }: GenerateBarcodeButtonProps) {
  const [result, setResult] = useState<{ id: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleClick() {
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/barcodes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType, entityId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not generate a barcode.");
      setResult({ id: body.data.id, code: body.data.code });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBusy(false);
    }
  }

  if (result) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="font-mono text-zinc-600 dark:text-zinc-300">{result.code}</span>
        <a
          href={`/api/v1/barcodes/${result.id}/label.pdf`}
          className="text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Print Label
        </a>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" size="xs" onClick={handleClick} isLoading={isBusy} loadingLabel="Generating…">
        Generate Barcode
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}

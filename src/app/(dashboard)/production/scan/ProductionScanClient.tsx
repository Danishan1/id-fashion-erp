"use client";

import { useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { BarcodeScanInput } from "@/components/ui/BarcodeScanInput";

interface ResolvedEntity {
  entityType: string;
  entityId: string;
  code: string;
  summary: Record<string, unknown>;
}

/**
 * The Universal Barcode Scanner (2026-09-29, spec §10) — one screen that
 * resolves ANY registered barcode (Fabric Roll / Production Lot / Carton /
 * Item / SKU) and hands the operator straight to that entity's own real
 * detail page, which already has the real Forward/Revert/QC/etc. actions
 * wired to their existing, unmodified service functions. This screen never
 * duplicates those actions itself — it's purely an identification/
 * navigation shortcut, exactly as the spec's own business rules require
 * (barcode is never the source of truth for a business transaction).
 */
export function ProductionScanClient() {
  const [result, setResult] = useState<ResolvedEntity | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleResolve(outcome: { ok: true; data: ResolvedEntity } | { ok: false; message: string }) {
    if (outcome.ok) {
      setResult(outcome.data);
      setError(null);
    } else {
      setResult(null);
      setError(outcome.message);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Barcode Scanner" }]} />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Barcode Scanner</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Scan a Fabric Roll, Production Lot, Carton, or Item/SKU barcode to jump straight to it.
        </p>
      </div>

      <div className="max-w-md">
        <BarcodeScanInput onResolve={handleResolve} placeholder="Scan a barcode…" />
      </div>

      {error && (
        <div className="max-w-md rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{result.entityType.replace("_", " ")}</p>
          <p className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-50">{result.code}</p>
          <EntitySummary result={result} />
        </div>
      )}
    </div>
  );
}

function EntitySummary({ result }: { result: ResolvedEntity }) {
  const s = result.summary;
  switch (result.entityType) {
    case "PRODUCTION_LOT":
      return (
        <div className="mt-3 space-y-1 text-sm">
          <p>Style: {String(s.styleName)}</p>
          <p>Order: {String(s.productionOrderNumber)}</p>
          <p>Quantity: {String(s.quantity)}</p>
          <p>Status: {String(s.status)}</p>
          <Link
            href={`/production-orders/${s.productionOrderId}/lots/${result.entityId}`}
            className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Open Lot →
          </Link>
        </div>
      );
    case "FABRIC_ROLL":
      return (
        <div className="mt-3 space-y-1 text-sm">
          <p>Material: {String(s.materialName)} ({String(s.materialCode)})</p>
          <p>Remaining: {String(s.remainingQuantity)}</p>
          <p>Status: {String(s.status)}</p>
        </div>
      );
    case "CARTON":
      return (
        <div className="mt-3 space-y-1 text-sm">
          <p>Dispatch: {String(s.dispatchNumber)}</p>
          <p>Carton #: {String(s.cartonNumber)}</p>
          <p>Quantity: {String(s.totalQuantity)}</p>
          <Link href={`/dispatch/${s.dispatchId}`} className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
            Open Dispatch →
          </Link>
        </div>
      );
    case "ITEM":
      return (
        <div className="mt-3 space-y-1 text-sm">
          <p>{String(s.styleName)}</p>
          <p>Code: {String(s.styleCode)}</p>
          <Link href={`/masters/materials/${result.entityId}`} className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
            Open Material →
          </Link>
        </div>
      );
    case "SKU":
      return (
        <div className="mt-3 space-y-1 text-sm">
          <p>{String(s.styleName)} ({String(s.colorName)} / {String(s.sizeName)})</p>
          <p>SKU: {String(s.skuCode)}</p>
          <Link href={`/masters/products/${s.productId}`} className="mt-2 inline-block text-indigo-600 hover:underline dark:text-indigo-400">
            Open Style →
          </Link>
        </div>
      );
    default:
      return null;
  }
}

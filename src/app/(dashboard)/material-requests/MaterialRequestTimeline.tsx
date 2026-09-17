"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  recordId: string;
  action: string;
  tableName: string;
  performedAt: string;
  user: { id: string; fullName: string } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

function describeEntry(entry: AuditEntry, warehouseNameById: Map<string, string>, uomCodeByLineId: Map<string, string>): string {
  const values = entry.newValues ?? {};
  if (entry.tableName === "material_requests") {
    if (entry.action === "CREATE") return `Material Request Created — ${values.requestNumber ?? ""}`;
    if (values.status === "FULFILLED") return "Material Request Fulfilled";
    if (values.status === "CLOSED") return "Material Request Closed";
    if (entry.action === "CANCEL" || values.status === "CANCELLED") return "Material Request Cancelled";
    if ("generatedGroups" in values) return `Purchase Order(s) Generated — ${values.succeeded ?? 0} succeeded`;
    if (values.status) return `Status changed to ${values.status}`;
    return "Material Request Updated";
  }
  if (entry.tableName === "material_request_items") {
    if ("issuedQuantity" in values) {
      // Present only when this specific issue actually came from a
      // different warehouse than the request's own stated one (the "Change
      // Warehouse" picker in the Issue modal) — every ordinary issue has
      // neither field at all, so the base label stays exactly as before.
      // A newer entry already stored the readable name directly; an older
      // one (from before that was added) only has the raw id, resolved here
      // from the warehouse list rather than rewriting the audit log itself.
      const name =
        (values.issuedFromWarehouseName as string | undefined) ??
        (typeof values.issuedFromWarehouseId === "string" ? warehouseNameById.get(values.issuedFromWarehouseId) : undefined);
      const fromWarehouse = name ? ` (from ${name})` : "";
      // Same backward-compat shape as the warehouse name above — a newer
      // entry already stored its own unit directly; an older one falls back
      // to the line's current unit (the closest available approximation,
      // rather than rewriting the audit log itself).
      const uomCode = (values.uomCode as string | undefined) ?? uomCodeByLineId.get(entry.recordId);
      const unit = uomCode ? ` ${uomCode}` : "";
      return `Material Issued — ${values.issuedQuantity}${unit}${fromWarehouse}`;
    }
    if ("purchaseOrderedQuantity" in values) {
      const suggested = (entry.oldValues as Record<string, unknown> | null)?.suggestedQuantity ?? "?";
      return `Purchase Quantity Changed — ${suggested} → ${values.purchaseOrderedQuantity}`;
    }
    return "Material Request Line Updated";
  }
  return `${entry.action} on ${entry.tableName}`;
}

export function MaterialRequestTimeline({
  materialRequestId,
  lines,
}: {
  materialRequestId: string;
  /** The request's own current lines, keyed by line id — used only as a
   * fallback to resolve a unit for an audit entry recorded before uomCode
   * was stored directly on it. */
  lines: Array<{ id: string; uomCode: string }>;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [warehouseNameById, setWarehouseNameById] = useState<Map<string, string>>(new Map());
  const uomCodeByLineId = new Map(lines.map((l) => [l.id, l.uomCode]));

  useEffect(() => {
    fetch(`/api/v1/material-requests/${materialRequestId}/audit-log`)
      .then((res) => res.json())
      .then((body) => setEntries(body.data ?? []));
    fetch(`/api/v1/warehouses?pageSize=200`)
      .then((res) => res.json())
      .then((body) => setWarehouseNameById(new Map((body.data ?? []).map((w: { id: string; name: string }) => [w.id, w.name]))));
  }, [materialRequestId]);

  if (entries.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Timeline</h2>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-baseline justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            <span className="text-zinc-700 dark:text-zinc-200">{describeEntry(entry, warehouseNameById, uomCodeByLineId)}</span>
            <span className="whitespace-nowrap text-xs text-zinc-400">
              {entry.user?.fullName ?? "System"} · {new Date(entry.performedAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

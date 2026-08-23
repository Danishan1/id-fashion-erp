"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  action: string;
  tableName: string;
  performedAt: string;
  user: { id: string; fullName: string } | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

function describeEntry(entry: AuditEntry): string {
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
    if ("issuedQuantity" in values) return `Material Issued — ${values.issuedQuantity}`;
    if ("purchaseOrderedQuantity" in values) {
      const suggested = (entry.oldValues as Record<string, unknown> | null)?.suggestedQuantity ?? "?";
      return `Purchase Quantity Changed — ${suggested} → ${values.purchaseOrderedQuantity}`;
    }
    return "Material Request Line Updated";
  }
  return `${entry.action} on ${entry.tableName}`;
}

export function MaterialRequestTimeline({ materialRequestId }: { materialRequestId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    fetch(`/api/v1/material-requests/${materialRequestId}/audit-log`)
      .then((res) => res.json())
      .then((body) => setEntries(body.data ?? []));
  }, [materialRequestId]);

  if (entries.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Timeline</h2>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-baseline justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
            <span className="text-zinc-700 dark:text-zinc-200">{describeEntry(entry)}</span>
            <span className="whitespace-nowrap text-xs text-zinc-400">
              {entry.user?.fullName ?? "System"} · {new Date(entry.performedAt).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

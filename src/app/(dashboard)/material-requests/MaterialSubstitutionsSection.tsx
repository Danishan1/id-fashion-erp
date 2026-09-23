"use client";

import { useState } from "react";

interface SubstitutionRow {
  id: string;
  materialRequestItemId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  quantity: string;
  uom: { code: string };
  reason: string;
  remarks: string | null;
  inventoryTransactionId: string | null;
  originalMaterial: { styleName: string; styleCode: string };
  substituteMaterial: { styleName: string; styleCode: string };
  requestedBy: { fullName: string };
  approvedBy: { fullName: string } | null;
  approvalRemark: string | null;
}

const REASON_LABELS: Record<string, string> = {
  ORIGINAL_MATERIAL_NOT_AVAILABLE: "Original material not available",
  QUALITY_ISSUE: "Quality issue",
  OTHER: "Other",
};

const STATUS_BADGE: Record<SubstitutionRow["status"], string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

/**
 * Material Substitution — history + approve/reject/issue (Phase 5/6/9 of the
 * Effective BOM work). Self-fetches on open, aggregating across every line
 * of the request (no single "all substitutions for this request" endpoint
 * exists — substitutions are scoped per-line, matching the real data model,
 * so this fans out one request per line and merges). A PENDING row's own
 * Approve/Reject/Issue buttons are always rendered — the server is the real
 * gate (self-approval-guarded `production`/`approve`), and a denied attempt
 * simply surfaces a clean error rather than being hidden client-side, which
 * would just be one more thing to keep in sync with RBAC.
 */
export function MaterialSubstitutionsSection({ lineIds }: { lineIds: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<SubstitutionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const results = await Promise.all(
      lineIds.map((id) =>
        fetch(`/api/v1/material-requests/lines/${id}/substitutions`)
          .then((res) => res.json())
          .then((body) => body.data ?? [])
      )
    );
    setRows(results.flat());
  };

  const toggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) await load();
  };

  const decide = async (id: string, action: "approve" | "reject" | "issue") => {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/v1/material-substitutions/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? `Failed to ${action} this substitution.`);
      return;
    }
    await load();
  };

  if (lineIds.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between text-left text-sm font-semibold text-zinc-900 dark:text-zinc-50"
      >
        <span>Material Substitutions</span>
        <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400">{isOpen ? "Hide" : "Show"}</span>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {rows === null && <p className="text-sm text-zinc-500">Loading…</p>}
          {rows !== null && rows.length === 0 && <p className="text-sm text-zinc-500">No substitutions proposed yet.</p>}
          {rows?.map((row) => (
            <div key={row.id} className="rounded-md border border-zinc-100 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}>{row.status}</span>
                <span className="text-zinc-700 dark:text-zinc-200">
                  {row.originalMaterial.styleName} <span className="text-zinc-400">→</span> {row.substituteMaterial.styleName}
                </span>
                <span className="text-zinc-500">
                  {row.quantity} {row.uom.code}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                {REASON_LABELS[row.reason] ?? row.reason} · requested by {row.requestedBy.fullName}
                {row.remarks && ` — ${row.remarks}`}
              </p>
              {row.approvedBy && (
                <p className="mt-1 text-xs text-zinc-500">
                  {row.status === "APPROVED" ? "Approved" : "Rejected"} by {row.approvedBy.fullName}
                  {row.approvalRemark && ` — ${row.approvalRemark}`}
                </p>
              )}
              {row.status === "PENDING" && (
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => decide(row.id, "approve")}
                    disabled={busyId === row.id}
                    className="text-xs font-medium text-green-700 hover:text-green-600 disabled:opacity-50 dark:text-green-400"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(row.id, "reject")}
                    disabled={busyId === row.id}
                    className="text-xs font-medium text-red-700 hover:text-red-600 disabled:opacity-50 dark:text-red-400"
                  >
                    Reject
                  </button>
                </div>
              )}
              {row.status === "APPROVED" && !row.inventoryTransactionId && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => decide(row.id, "issue")}
                    disabled={busyId === row.id}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50 dark:text-indigo-400"
                  >
                    Issue Now
                  </button>
                </div>
              )}
              {row.status === "APPROVED" && row.inventoryTransactionId && (
                <p className="mt-2 text-xs text-green-600 dark:text-green-400">Issued.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

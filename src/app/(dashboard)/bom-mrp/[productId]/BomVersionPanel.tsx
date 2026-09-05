"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { formatDate, formatDateTime } from "@/lib/date-format";

interface VersionRow {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  approvedAt: string | null;
  approvedBy: { fullName: string } | null;
  items: unknown[];
}

const STATUS_BADGE_CLASSES: Record<VersionRow["status"], string> = {
  DRAFT: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  APPROVED: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  SUPERSEDED: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export function BomVersionPanel({
  productId,
  versions,
  currentVersionNumber,
  canApprove,
}: {
  productId: string;
  versions: VersionRow[];
  currentVersionNumber: number;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = versions.find((v) => v.versionNumber === currentVersionNumber) ?? null;

  async function handleApprove() {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bom-mrp/${productId}/approve`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to approve this BOM version");
      setConfirmOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve this BOM version");
    } finally {
      setIsApproving(false);
    }
  }

  if (!current) {
    return <p className="text-sm text-zinc-400">No BOM version yet — add materials below and save to create Version 1.</p>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-50">Version {current.versionNumber}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[current.status]}`}>{current.status}</span>
          {current.status === "APPROVED" && current.approvedBy && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              approved by {current.approvedBy.fullName} on {formatDate(current.approvedAt!)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {versions.length > 1 && (
            <button type="button" onClick={() => setShowHistory((v) => !v)} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              {showHistory ? "Hide" : "Show"} version history
            </button>
          )}
          {canApprove && current.status === "DRAFT" && (
            <button
              type="button"
              disabled={current.items.length === 0}
              onClick={() => setConfirmOpen(true)}
              title={current.items.length === 0 ? "Add at least one material line before approving" : undefined}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Approve Version {current.versionNumber}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {showHistory && (
        <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Version</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Status</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Created By</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Created</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-500">Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{v.versionNumber}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[v.status]}`}>{v.status}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{v.createdBy.fullName}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{formatDateTime(v.createdAt)}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {v.approvedAt ? `${v.approvedBy?.fullName ?? "—"} · ${formatDateTime(v.approvedAt)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={confirmOpen}
        title={`Approve Version ${current.versionNumber}?`}
        message="Once approved, this version is locked — Material Requirements Planning and Production will use it, and further edits will start a new version instead of changing this one."
        confirmLabel="Approve"
        isBusy={isApproving}
        onConfirm={handleApprove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

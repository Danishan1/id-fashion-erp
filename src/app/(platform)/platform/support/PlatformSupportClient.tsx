"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Modal } from "@/components/ui/Modal";

interface SupportRequestRow {
  id: string;
  reason: string;
  durationMinutes: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "LOCKED";
  codeExpiresAt: string;
  rejectionReason: string | null;
  createdAt: string;
  company: { id: string; name: string; isActive: boolean };
  requestedBy: string;
  isOwn: boolean;
  decidedBy: string | null;
  session: {
    id: string;
    mode: "READ_ONLY" | "READ_WRITE";
    expiresAt: string;
    revokedAt: string | null;
    endedAt: string | null;
    isLive: boolean;
  } | null;
}

const DURATIONS = [15, 30, 60, 120];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function statusText(row: SupportRequestRow): string {
  if (row.session?.isLive) return row.session.mode === "READ_WRITE" ? "Approved · live (read & write)" : "Approved · live (read-only)";
  if (row.status === "APPROVED") {
    if (row.session?.revokedAt) return "Revoked by customer";
    if (row.session?.endedAt) return "Ended";
    return "Expired";
  }
  const map: Record<SupportRequestRow["status"], string> = {
    PENDING: "Waiting for customer",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled",
    LOCKED: "Locked (wrong codes)",
  };
  return map[row.status];
}

export function PlatformSupportClient({
  canRequest,
  initialCompanyId,
  companies,
  initialRequests,
}: {
  canRequest: boolean;
  initialCompanyId: string;
  companies: { id: string; name: string }[];
  initialRequests: SupportRequestRow[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [formOpen, setFormOpen] = useState(canRequest && !!initialCompanyId);
  const [companyId, setCompanyId] = useState(initialCompanyId);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(30);
  const [issued, setIssued] = useState<{ code: string; companyName: string; codeExpiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await fetch("/api/v1/platform/support-requests", { cache: "no-store" });
    if (res.ok) setRequests((await res.json()).data);
  }

  function closeForm() {
    setFormOpen(false);
    setIssued(null);
    setReason("");
    setError(null);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/platform/support-requests", {
        method: "POST",
        headers: { "content-type": "application/json", "x-toast": "errors" },
        body: JSON.stringify({ companyId, reason, durationMinutes: duration }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not create the request.");
        return;
      }
      setIssued({ code: body.data.code, companyName: body.data.request.companyName, codeExpiresAt: body.data.request.codeExpiresAt });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/v1/platform/support-requests/${id}/cancel`, { method: "POST" });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function openSession(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/platform/support-requests/${id}/open`, { method: "POST", headers: { "x-toast": "errors" } });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        await reload();
        return;
      }
      // Replaces this browser's platform sign-in with the support session.
      // Ending the session (support banner) brings you back to platform sign-in.
      await signIn("support-session", { token: body.data.token, callbackUrl: "/dashboard" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {canRequest && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Request access
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="px-4 py-2 font-medium">Company</th>
              <th className="px-4 py-2 font-medium">Requested</th>
              <th className="px-4 py-2 font-medium">By</th>
              <th className="px-4 py-2 font-medium">Reason</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  No support requests yet.
                </td>
              </tr>
            )}
            {requests.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-4 py-2 font-medium text-zinc-900 dark:text-zinc-50">{row.company.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{fmt(row.createdAt)}</td>
                <td className="px-4 py-2">{row.requestedBy}</td>
                <td className="px-4 py-2 text-zinc-600 dark:text-zinc-300">{row.reason}</td>
                <td className="px-4 py-2">
                  {statusText(row)}
                  {row.session?.isLive && <div className="text-xs text-zinc-500">until {fmt(row.session.expiresAt)}</div>}
                  {row.rejectionReason && <div className="text-xs text-zinc-500">{row.rejectionReason}</div>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {row.isOwn && row.session?.isLive && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => openSession(row.id)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
                    >
                      Open ERP
                    </button>
                  )}
                  {row.isOwn && row.status === "PENDING" && (
                    <button type="button" disabled={busy} onClick={() => cancel(row.id)} className="text-red-600 hover:underline">
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={formOpen} onClose={closeForm} title={issued ? "Give this code to the customer" : "Request support access"}>
        {issued ? (
          <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
            <p>
              Ask the Super Admin of <strong>{issued.companyName}</strong> to open Administration → Support Access and approve
              your request with this code.
            </p>
            <p className="rounded-md bg-zinc-100 py-3 text-center font-mono text-2xl tracking-[0.4em] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
              {issued.code}
            </p>
            <p className="text-xs text-zinc-500">Valid until {fmt(issued.codeExpiresAt)}. It won&apos;t be shown again.</p>
            <div className="flex justify-end">
              <button type="button" onClick={closeForm} className="rounded-md bg-indigo-600 px-3 py-1.5 text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Company</span>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">Select a company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Reason (shown to the customer)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                placeholder="e.g. Ticket #142 — dispatch DSP-2026-00031 shows the wrong carton count"
              />
            </label>
            <label className="block">
              <span className="text-zinc-600 dark:text-zinc-300">Duration</span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} minutes` : `${d / 60} hour${d > 60 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="rounded-md border border-zinc-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !companyId || reason.trim().length < 10}
                onClick={create}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Create request
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

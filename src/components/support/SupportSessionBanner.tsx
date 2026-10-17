"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";

interface SupportStatus {
  sessionId: string;
  companyName: string;
  operatorName: string;
  mode: "READ_ONLY" | "READ_WRITE";
  expiresAt: string;
  writeStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED" | "LOCKED";
  writeCodeExpiresAt: string | null;
}

const POLL_MS = 30_000;

function minutesLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

/**
 * Always-visible strip at the top of the ERP during a customer-approved
 * support session (Platform SaaS Phase 2). Shows whose data this is, the
 * mode and time left, and lets the operator request write access or end the
 * session. If the session is revoked or expires, the next status check sends
 * the browser to /support-ended.
 */
export function SupportSessionBanner() {
  const router = useRouter();
  const [status, setStatus] = useState<SupportStatus | null>(null);
  const [, setTick] = useState(0);
  const [writeOpen, setWriteOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const [writeCode, setWriteCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/support-session/status", { cache: "no-store" });
    if (res.status === 403 || res.status === 401) {
      router.replace("/support-ended");
      return;
    }
    if (res.ok) {
      const body = await res.json();
      setStatus(body.data);
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    const run = () => {
      if (active) void load();
    };
    const first = setTimeout(run, 0);
    const poll = setInterval(run, POLL_MS);
    // Re-render every 30s so the "minutes left" count stays current.
    const clock = setInterval(() => setTick((t) => t + 1), POLL_MS);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  async function requestWrite() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/support-session/write-request", {
        method: "POST",
        headers: { "content-type": "application/json", "x-toast": "errors" },
        body: JSON.stringify({ justification }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not request write access.");
        return;
      }
      setWriteCode(body.data.code);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function endSession() {
    setBusy(true);
    try {
      await fetch("/api/v1/support-session/end", { method: "POST", headers: { "x-toast": "off" } });
    } finally {
      await signOut({ callbackUrl: "/platform/login" });
    }
  }

  function closeWriteModal() {
    setWriteOpen(false);
    setWriteCode(null);
    setJustification("");
    setError(null);
  }

  const readOnly = status?.mode !== "READ_WRITE";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm text-white ${
        readOnly ? "bg-amber-600" : "bg-red-700"
      }`}
    >
      <span className="font-semibold">Support session</span>
      {status ? (
        <>
          <span>
            {status.companyName} · {readOnly ? "Read-only" : "Read & write"} · {minutesLeft(status.expiresAt)} min left
          </span>
          {status.writeStatus === "PENDING" && <span className="text-amber-100">Write access waiting for customer approval</span>}
          {status.writeStatus === "REJECTED" && <span className="text-amber-100">Write access was rejected</span>}
          {status.writeStatus === "LOCKED" && <span className="text-amber-100">Write access locked</span>}
        </>
      ) : (
        <span>Checking session…</span>
      )}
      <span className="ml-auto flex gap-2">
        {status && readOnly && status.writeStatus !== "LOCKED" && (
          <button
            type="button"
            onClick={() => setWriteOpen(true)}
            className="rounded border border-white/60 px-2 py-0.5 text-xs font-medium hover:bg-white/10"
          >
            {status.writeStatus === "PENDING" ? "New write code" : "Request write access"}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={endSession}
          className="rounded bg-white px-2 py-0.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
        >
          End session
        </button>
      </span>

      <Modal open={writeOpen} onClose={closeWriteModal} title="Request write access">
        {writeCode ? (
          <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-200">
            <p>Give this code to the customer. Their Super Admin enters it under Administration → Support Access.</p>
            <p className="rounded-md bg-zinc-100 py-3 text-center font-mono text-2xl tracking-[0.4em] text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50">
              {writeCode}
            </p>
            <p className="text-xs text-zinc-500">Valid for 10 minutes. It won&apos;t be shown again.</p>
            <div className="flex justify-end">
              <button type="button" onClick={closeWriteModal} className="rounded-md bg-indigo-600 px-3 py-1.5 text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-600 dark:text-zinc-300">
              The session is read-only. To change data, explain what you need to change and why. The customer must approve
              it with a separate code.
            </p>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="e.g. Correct the wrong unit on Material Request MR-2026-00012, line 2"
            />
            {error && <p className="text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeWriteModal} className="rounded-md border border-zinc-300 px-3 py-1.5">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || justification.trim().length < 10}
                onClick={requestWrite}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-60"
              >
                Get code
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

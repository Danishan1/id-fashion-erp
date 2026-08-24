"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface JournalLine {
  id: string;
  accountId: string;
  debitAmount: string;
  creditAmount: string;
  description: string | null;
  account: { code: string; name: string };
}

interface JournalDetail {
  id: string;
  journalNumber: string;
  journalDate: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  narration: string | null;
  totalDebit: string;
  totalCredit: string;
  postedAt: string | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
  reversalOf: { id: string; journalNumber: string } | null;
  reversedByJournal: { id: string; journalNumber: string } | null;
  lines: JournalLine[];
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function JournalWorkflowPanel({ journal }: { journal: JournalDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [reverseNarration, setReverseNarration] = useState("");

  const runAction = async (url: string, body?: unknown) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    setIsBusy(false);
    if (!res.ok) {
      const resBody = await res.json().catch(() => null);
      setError(resBody?.error?.message ?? "Action failed.");
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[journal.status]}`}>{journal.status}</span>
        {journal.reversalOf && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Reversal of{" "}
            <Link href={`/accounts/journals/${journal.reversalOf.id}`} className="text-indigo-600 hover:text-indigo-500">
              {journal.reversalOf.journalNumber}
            </Link>
          </span>
        )}
        {journal.reversedByJournal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Reversed by{" "}
            <Link href={`/accounts/journals/${journal.reversedByJournal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {journal.reversedByJournal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{journal.journalDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{journal.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Posted By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{journal.postedBy?.fullName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Narration</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{journal.narration ?? "—"}</dd>
        </div>
      </dl>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Debit</th>
              <th className="px-3 py-2 font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {journal.lines.map((line) => (
              <tr key={line.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="px-3 py-2">
                  {line.account.code} — {line.account.name}
                </td>
                <td className="px-3 py-2">{line.description ?? "—"}</td>
                <td className="px-3 py-2">{Number(line.debitAmount) > 0 ? Number(line.debitAmount).toFixed(2) : ""}</td>
                <td className="px-3 py-2">{Number(line.creditAmount) > 0 ? Number(line.creditAmount).toFixed(2) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-zinc-200 font-medium dark:border-zinc-800">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2">{Number(journal.totalDebit).toFixed(2)}</td>
              <td className="px-3 py-2">{Number(journal.totalCredit).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-3">
        {journal.status === "DRAFT" && (
          <>
            <button
              onClick={() => setShowPostConfirm(true)}
              disabled={isBusy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Post
            </button>
            <button
              onClick={() => setShowCancelConfirm(true)}
              disabled={isBusy}
              className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400"
            >
              Cancel
            </button>
          </>
        )}
        {journal.status === "POSTED" && !journal.reversedByJournal && (
          <button
            onClick={() => setShowReverseModal(true)}
            disabled={isBusy}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200"
          >
            Reverse
          </button>
        )}
      </div>

      <ConfirmModal
        open={showPostConfirm}
        title="Post journal?"
        message={`Posting will lock this journal permanently — future corrections require a reversal. Total debit ${journal.lines.reduce((s, l) => s + Number(l.debitAmount), 0).toFixed(2)}.`}
        confirmLabel="Post"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/journals/${journal.id}/post`);
          if (ok) setShowPostConfirm(false);
        }}
        onCancel={() => setShowPostConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel journal?"
        message="This draft journal will be cancelled and can no longer be posted."
        confirmLabel="Cancel Journal"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/journals/${journal.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showReverseModal} title="Reverse journal" onClose={() => setShowReverseModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Creates a new, auto-posted journal with every line&apos;s debit/credit flipped. This journal stays POSTED — it
            is never edited or un-posted.
          </p>
          <FormField label="Narration (optional)" htmlFor="reverseNarration">
            <input
              id="reverseNarration"
              value={reverseNarration}
              onChange={(e) => setReverseNarration(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <div className="flex gap-3">
            <button
              onClick={async () => {
                const ok = await runAction(`/api/v1/journals/${journal.id}/reverse`, { narration: reverseNarration });
                if (ok) setShowReverseModal(false);
              }}
              disabled={isBusy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isBusy ? "Reversing…" : "Reverse"}
            </button>
            <button
              onClick={() => setShowReverseModal(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

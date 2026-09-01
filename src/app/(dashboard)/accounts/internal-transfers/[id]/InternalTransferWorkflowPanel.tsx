"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../../simpleDocumentStatusLabels";

interface InternalTransferDetail {
  id: string;
  transferNumber: string;
  transferDate: string;
  amount: string;
  narration: string | null;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  fromPaymentType: { name: string };
  toPaymentType: { name: string };
  fromBankAccount: { name: string; bankName: string } | null;
  toBankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
}

export function InternalTransferWorkflowPanel({ transfer }: { transfer: InternalTransferDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const runAction = async (url: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Action failed.");
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[transfer.status]}`}>{STATUS_LABELS[transfer.status] ?? transfer.status}</span>
        {transfer.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${transfer.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {transfer.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">From</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {transfer.fromPaymentType.name}
            {transfer.fromBankAccount && ` (${transfer.fromBankAccount.name})`}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">To</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {transfer.toPaymentType.name}
            {transfer.toBankAccount && ` (${transfer.toBankAccount.name})`}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Transfer Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{transfer.transferDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Amount</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(transfer.amount).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Narration</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{transfer.narration ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{transfer.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Posted By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{transfer.postedBy?.fullName ?? "—"}</dd>
        </div>
      </dl>

      {transfer.status === "DRAFT" && (
        <div className="flex gap-3">
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
        </div>
      )}

      <ConfirmModal
        open={showPostConfirm}
        title="Post transfer?"
        message={`Posting will lock this transfer permanently and auto-create a Journal (Dr ${transfer.toPaymentType.name} / Cr ${transfer.fromPaymentType.name}) for ₹${Number(transfer.amount).toFixed(2)}.`}
        confirmLabel="Post"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/internal-transfers/${transfer.id}/post`);
          if (ok) setShowPostConfirm(false);
        }}
        onCancel={() => setShowPostConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel transfer?"
        message="This draft transfer will be cancelled."
        confirmLabel="Cancel Transfer"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/internal-transfers/${transfer.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
}

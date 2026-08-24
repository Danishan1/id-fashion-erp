"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { formatCurrency } from "@/lib/currency";

interface Person {
  fullName: string;
}

interface AttachmentRow {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  uploadedAt: string;
  uploadedBy: Person;
  contextLabel: string | null;
}

interface ExpenseDetail {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  description: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
  referenceNumber: string | null;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  account: { code: string; name: string };
  supplier: { name: string } | null;
  taxRate: { name: string } | null;
  paymentType: { name: string };
  bankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  postedBy: { fullName: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

async function parseErrorMessage(res: Response, fallback: string) {
  const body = await res.json().catch(() => null);
  return body?.error?.message ?? fallback;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExpenseWorkflowPanel({ expense }: { expense: ExpenseDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/expenses/${expense.id}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/expenses/${expense.id}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [expense.id]);

  const runAction = async (url: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(url, { method: "POST" });
    setIsBusy(false);
    if (!res.ok) {
      setError(await parseErrorMessage(res, "Action failed."));
      return false;
    }
    router.refresh();
    return true;
  };

  const uploadAttachment = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/expenses/${expense.id}/attachments`, { method: "POST", body: formData });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to upload the file."));
      setIsBusy(false);
      return;
    }

    setUploadFile(null);
    setUploadInputKey((k) => k + 1);
    await fetchAttachments();
    setIsBusy(false);
  };

  const deleteAttachment = async (attachmentId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/expenses/attachments/${attachmentId}`, { method: "DELETE" });

    if (!res.ok) {
      setError(await parseErrorMessage(res, "Failed to delete the file."));
      setIsBusy(false);
      return;
    }

    await fetchAttachments();
    setIsBusy(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[expense.status] ?? ""}`}>{expense.status}</span>
        {expense.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${expense.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {expense.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Account</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {expense.account.code} — {expense.account.name}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Description</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.description}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Expense Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.expenseDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Supplier</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.supplier?.name ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Amount</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{formatCurrency(expense.amount)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Tax</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {expense.taxRate ? `${expense.taxRate.name} (₹${formatCurrency(expense.taxAmount)})` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Total</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{formatCurrency(expense.totalAmount)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Payment Type</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.paymentType.name}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Bank Account</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {expense.bankAccount ? `${expense.bankAccount.name} — ${expense.bankAccount.bankName}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Reference No.</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.referenceNumber ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.createdBy.fullName}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Approved By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{expense.postedBy?.fullName ?? "—"}</dd>
        </div>
      </dl>

      {expense.status === "DRAFT" && (
        <div className="flex gap-3">
          <Link
            href={`/accounts/expenses/${expense.id}/edit`}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            Edit
          </Link>
          <button
            onClick={() => setShowApproveConfirm(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Approve
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

      <div>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Attachments</h2>
        <div className="space-y-2">
          {attachments.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div>
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(a)}
                  className="font-medium text-indigo-600 hover:text-indigo-500"
                >
                  {a.fileName}
                </button>
                <p className="text-xs text-zinc-400">
                  {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName} · {new Date(a.uploadedAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => deleteAttachment(a.id)}
                disabled={isBusy}
                className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            key={uploadInputKey}
            type="file"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="text-sm text-zinc-600 dark:text-zinc-300"
          />
          <button
            type="button"
            onClick={uploadAttachment}
            disabled={isBusy || !uploadFile}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            Upload
          </button>
        </div>
        <p className="mt-1 text-xs text-zinc-400">A receipt or bill photo — JPEG, PNG, WEBP, PDF, Word, or Excel, up to 20 MB.</p>
      </div>

      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/expenses/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/expenses/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}

      <ConfirmModal
        open={showApproveConfirm}
        title="Approve expense?"
        message={`Approving will lock this expense permanently and auto-create a settlement Journal (Dr ${expense.account.name}${Number(expense.taxAmount) > 0 ? " / Dr GST Input Tax Credit" : ""} / Cr Cash-or-Bank) for ₹${formatCurrency(expense.totalAmount)}.`}
        confirmLabel="Approve"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/expenses/${expense.id}/approve`);
          if (ok) setShowApproveConfirm(false);
        }}
        onCancel={() => setShowApproveConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel expense?"
        message="This draft expense will be cancelled."
        confirmLabel="Cancel Expense"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/expenses/${expense.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { FormField, textInputClass } from "@/components/ui/FormField";

interface SettlementRow {
  id: string;
  settlementNumber: string;
  settlementDate: string;
  description: string;
  amount: string;
  taxAmount: string;
  totalAmount: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  expenseAccount: { code: string; name: string };
  taxRate: { name: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
}

interface EmployeeAdvanceDetail {
  id: string;
  advanceNumber: string;
  advanceDate: string;
  amount: string;
  settledAmount: string;
  purpose: string | null;
  status: "DRAFT" | "ISSUED" | "PARTIALLY_SETTLED" | "SETTLED" | "CANCELLED";
  employee: { fullName: string; employeeCode: string };
  paymentType: { name: string };
  bankAccount: { name: string; bankName: string } | null;
  journal: { id: string; journalNumber: string } | null;
  createdBy: { fullName: string };
  settlements: SettlementRow[];
}

interface ChartOfAccountOption {
  id: string;
  code: string;
  name: string;
  accountType: string;
  isActive: boolean;
}

interface TaxRateOption {
  id: string;
  name: string;
  ratePercentage: string;
}

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
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Small per-settlement bill/receipt attachments modal — a settlement's
 * "small focused action" (matching Modal's own documented convention),
 * kept compact since it lives inside a table row rather than a full page.
 * A bill can be attached here at any time, not just at settlement creation. */
function SettlementAttachmentsModal({ settlementId, onClose }: { settlementId: string; onClose: () => void }) {
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadInputKey, setUploadInputKey] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentRow | null>(null);

  const fetchAttachments = async () => {
    const res = await fetch(`/api/v1/employee-advance-settlements/${settlementId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  };

  useEffect(() => {
    fetch(`/api/v1/employee-advance-settlements/${settlementId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [settlementId]);

  const upload = async () => {
    if (!uploadFile) return;
    setIsBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", uploadFile);
    const res = await fetch(`/api/v1/employee-advance-settlements/${settlementId}/attachments`, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to upload the file.");
      setIsBusy(false);
      return;
    }
    setUploadFile(null);
    setUploadInputKey((k) => k + 1);
    await fetchAttachments();
    setIsBusy(false);
  };

  const remove = async (attachmentId: string) => {
    setIsBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/employee-advance-settlements/attachments/${attachmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to delete the file.");
      setIsBusy(false);
      return;
    }
    await fetchAttachments();
    setIsBusy(false);
  };

  return (
    <Modal open onClose={onClose} title="Bill / Receipt">
      <div className="space-y-3">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {attachments.length === 0 && <p className="text-sm text-zinc-500">No files uploaded yet.</p>}
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <div>
              <button type="button" onClick={() => setPreviewAttachment(a)} className="font-medium text-indigo-600 hover:text-indigo-500">
                {a.fileName}
              </button>
              <p className="text-xs text-zinc-400">
                {formatFileSize(a.fileSizeBytes)} · {a.uploadedBy.fullName} · {new Date(a.uploadedAt).toLocaleString()}
              </p>
            </div>
            <button type="button" onClick={() => remove(a.id)} disabled={isBusy} className="text-xs font-medium text-red-600 hover:text-red-500 disabled:opacity-50">
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input key={uploadInputKey} type="file" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} className="text-sm text-zinc-600 dark:text-zinc-300" />
          <button
            type="button"
            onClick={upload}
            disabled={isBusy || !uploadFile}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
          >
            Upload
          </button>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
      {previewAttachment && (
        <FilePreviewModal
          key={previewAttachment.id}
          open
          onClose={() => setPreviewAttachment(null)}
          previewUrl={`/api/v1/employee-advance-settlements/attachments/${previewAttachment.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/employee-advance-settlements/attachments/${previewAttachment.id}/download`}
          fileName={previewAttachment.fileName}
          mimeType={previewAttachment.mimeType}
        />
      )}
    </Modal>
  );
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  ISSUED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  PARTIALLY_SETTLED: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  SETTLED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  CANCELLED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function EmployeeAdvanceWorkflowPanel({ advance }: { advance: EmployeeAdvanceDetail }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [showIssueConfirm, setShowIssueConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [accounts, setAccounts] = useState<ChartOfAccountOption[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [attachmentsForSettlementId, setAttachmentsForSettlementId] = useState<string | null>(null);
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [settlementAmount, setSettlementAmount] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [settlementError, setSettlementError] = useState<string | null>(null);
  const [isSubmittingSettlement, setIsSubmittingSettlement] = useState(false);

  useEffect(() => {
    fetch("/api/v1/chart-of-accounts?pageSize=500")
      .then((res) => res.json())
      .then((body) => setAccounts((body.data ?? []).filter((a: ChartOfAccountOption) => a.accountType === "EXPENSE" && a.code !== "COGS" && a.isActive)))
      .catch(() => {});
    fetch("/api/v1/tax-rates")
      .then((res) => res.json())
      .then((body) => setTaxRates(body.data ?? []))
      .catch(() => {});
  }, []);

  const remaining = (Number(advance.amount) - Number(advance.settledAmount)).toFixed(2);

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

  const openSettlementModal = () => {
    setSettlementDate(new Date().toISOString().slice(0, 10));
    setExpenseAccountId("");
    setDescription("");
    setSettlementAmount("");
    setTaxRateId("");
    setSettlementError(null);
    setShowSettlementModal(true);
  };

  const submitSettlement = async () => {
    if (isSubmittingSettlement) return;
    setIsSubmittingSettlement(true);
    setSettlementError(null);
    try {
      const res = await fetch(`/api/v1/employee-advances/${advance.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settlementDate,
          expenseAccountId,
          description,
          amount: Number(settlementAmount) || 0,
          taxRateId: taxRateId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSettlementError(body?.error?.message ?? "Failed to add settlement.");
        return;
      }
      setShowSettlementModal(false);
      router.refresh();
    } catch {
      setSettlementError("Could not reach the server.");
    } finally {
      setIsSubmittingSettlement(false);
    }
  };

  const canSettle = advance.status === "ISSUED" || advance.status === "PARTIALLY_SETTLED";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[advance.status] ?? ""}`}>{advance.status}</span>
        {advance.journal && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            Journal:{" "}
            <Link href={`/accounts/journals/${advance.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
              {advance.journal.journalNumber}
            </Link>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Employee</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            {advance.employee.fullName} ({advance.employee.employeeCode})
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Advance Date</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{advance.advanceDate.slice(0, 10)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Amount</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">₹{Number(advance.amount).toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Settled / Remaining</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">
            ₹{Number(advance.settledAmount).toFixed(2)} / ₹{remaining}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Purpose</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{advance.purpose ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Payment Type</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{advance.paymentType.name}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Created By</dt>
          <dd className="font-medium text-zinc-900 dark:text-zinc-50">{advance.createdBy.fullName}</dd>
        </div>
      </dl>

      {advance.status === "DRAFT" && (
        <div className="flex gap-3">
          <button
            onClick={() => setShowIssueConfirm(true)}
            disabled={isBusy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Issue
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
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Settlements</h2>
          {canSettle && (
            <button type="button" onClick={openSettlementModal} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              + Add Settlement
            </button>
          )}
        </div>
        {advance.settlements.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No settlements recorded yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-3 py-2 font-medium">Number</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Expense Account</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {advance.settlements.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2">{s.settlementNumber}</td>
                    <td className="px-3 py-2">{s.settlementDate.slice(0, 10)}</td>
                    <td className="px-3 py-2">
                      {s.expenseAccount.code} — {s.expenseAccount.name}
                    </td>
                    <td className="px-3 py-2">{s.description}</td>
                    <td className="px-3 py-2">₹{Number(s.totalAmount).toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[s.status] ?? ""}`}>{s.status}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAttachmentsForSettlementId(s.id)}
                          className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Bill
                        </button>
                        {s.status === "DRAFT" && (
                          <>
                            <button
                              type="button"
                              onClick={() => runAction(`/api/v1/employee-advance-settlements/${s.id}/post`)}
                              disabled={isBusy}
                              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            >
                              Post
                            </button>
                            <button
                              type="button"
                              onClick={() => runAction(`/api/v1/employee-advance-settlements/${s.id}/cancel`)}
                              disabled={isBusy}
                              className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={showIssueConfirm}
        title="Issue advance?"
        message={`Issuing will lock this advance permanently and auto-create a Journal (Dr Employee Advances / Cr Cash-or-Bank) for ₹${Number(advance.amount).toFixed(2)}.`}
        confirmLabel="Issue"
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/employee-advances/${advance.id}/issue`);
          if (ok) setShowIssueConfirm(false);
        }}
        onCancel={() => setShowIssueConfirm(false)}
      />

      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel advance?"
        message="This draft advance will be cancelled."
        confirmLabel="Cancel Advance"
        isDangerous
        isBusy={isBusy}
        onConfirm={async () => {
          const ok = await runAction(`/api/v1/employee-advances/${advance.id}/cancel`);
          if (ok) setShowCancelConfirm(false);
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />

      <Modal open={showSettlementModal} onClose={() => setShowSettlementModal(false)} title="Add Settlement">
        <div className="space-y-3">
          <FormField label="Settlement Date" htmlFor="settlementDate" required>
            <input id="settlementDate" type="date" required value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Expense Account" htmlFor="expenseAccountId" required>
            <select id="expenseAccountId" required value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)} className={textInputClass()}>
              <option value="">— Select —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Description" htmlFor="description" required>
            <input id="description" required value={description} onChange={(e) => setDescription(e.target.value)} className={textInputClass()} />
          </FormField>
          <FormField label="Amount" htmlFor="settlementAmount" required>
            <input
              id="settlementAmount"
              type="number"
              min={0}
              step="0.01"
              required
              value={settlementAmount}
              onChange={(e) => setSettlementAmount(e.target.value)}
              className={textInputClass()}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Remaining on this advance: ₹{remaining}</p>
          </FormField>
          <FormField label="Tax Rate (optional)" htmlFor="taxRateId">
            <select id="taxRateId" value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)} className={textInputClass()}>
              <option value="">No tax</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormField>
          {settlementError && <p className="text-sm text-red-600 dark:text-red-400">{settlementError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowSettlementModal(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitSettlement}
              disabled={isSubmittingSettlement}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSubmittingSettlement ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </Modal>

      {attachmentsForSettlementId && (
        <SettlementAttachmentsModal settlementId={attachmentsForSettlementId} onClose={() => setAttachmentsForSettlementId(null)} />
      )}
    </div>
  );
}

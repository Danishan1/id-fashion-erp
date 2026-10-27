"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AttachmentsPanel } from "@/components/ui/AttachmentsPanel";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/currency";
import {
  PAYMENT_REQUEST_GROUP_LABELS,
  PAYMENT_REQUEST_STATUS_LABELS,
  PAYMENT_REQUEST_TYPE_DEFS,
  type PaymentRequestGroupKey,
  type PaymentRequestTypeKey,
} from "@/modules/accounts/payment-requests/request-type-registry";
import Link from "next/link";
import { PaymentRequestForm } from "../PaymentRequestForm";
import { PayoutModal } from "./PayoutModal";
import { PAYMENT_REQUEST_STATUS_STYLES } from "../statusStyles";

interface PaymentRequestDetail {
  id: string;
  requestNumber: string;
  requestType: PaymentRequestTypeKey;
  requestGroup: PaymentRequestGroupKey;
  status: string;
  routing: "APPROVAL_THEN_PAY" | "DIRECT_TO_ACCOUNTANT";
  amount: string;
  paidAmount: string;
  payToName: string;
  supplierId: string | null;
  employeeId: string | null;
  paymentDueDate: string;
  modeOfTransfer: string | null;
  remark: string | null;
  rejectionReason: string | null;
  isOverdue: boolean;
  createdAt: string;
  approvedAt: string | null;
  createdBy: { fullName: string };
  approvedBy: { fullName: string } | null;
  rejectedBy: { fullName: string } | null;
  cancelledBy: { fullName: string } | null;
  requiredApprovalLevels: number;
  currentApprovalLevel: number;
  approverMayPay: boolean;
  approvalPlanJson: {
    ruleId: string | null;
    levels: { level: number; anyApprover: boolean; users: { name: string }[]; roles: { name: string }[] }[];
  } | null;
  approvals: { id: string; level: number; decision: "APPROVED" | "REJECTED"; remark: string | null; decidedAt: string; user: { fullName: string } }[];
  payouts: {
    id: string;
    paymentDate: string;
    amount: string;
    referenceNumber: string | null;
    paymentType: { name: string; type: string };
    bankAccount: { name: string; bankName: string } | null;
    journal: { id: string; journalNumber: string };
    payment: { id: string; paymentNumber: string } | null;
    internalTransfer: { id: string; transferNumber: string } | null;
    createdBy: { fullName: string };
  }[];
}

/** Paid in one go (one transfer / deposit) — mirrors FULL_PAYOUT_ONLY in payout.service.ts. */
const FULL_PAYOUT_ONLY = ["CASH_WITHDRAWAL", "FIXED_DEPOSIT", "RECURRING_DEPOSIT", "BANK_TRANSFER", "LOAN", "IMPREST"];

interface Permissions {
  canApprove: boolean;
  canReject: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canPay: boolean;
  /** Approved, but this type cannot be paid from here yet (its skill is not built). */
  payNotAvailableYet: boolean;
  canEditFiles: boolean;
}

export function PaymentRequestWorkflowPanel({ request, permissions }: { request: PaymentRequestDetail; permissions: Permissions }) {
  const router = useRouter();
  const def = PAYMENT_REQUEST_TYPE_DEFS[request.requestType];
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | null>(null);
  const [showApprove, setShowApprove] = useState(false);
  const [approveRemark, setApproveRemark] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const remaining = Math.round((Number(request.amount) - Number(request.paidAmount)) * 100) / 100;

  const runAction = async (path: string, body?: unknown) => {
    setIsBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/payment-requests/${request.id}/${path}`, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error?.message ?? "Action failed.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Network error — please try again.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const plan = request.approvalPlanJson;
  const isLastLevel = request.currentApprovalLevel >= request.requiredApprovalLevels;
  const currentLevel = plan?.levels.find((l) => l.level === request.currentApprovalLevel);
  const currentApprovers = !currentLevel
    ? ""
    : currentLevel.anyApprover
      ? "anyone with the Approve permission"
      : [...currentLevel.roles.map((r) => `role ${r.name}`), ...currentLevel.users.map((u) => u.name)].join(", ");

  const hasActions = permissions.canPay || permissions.canApprove || permissions.canReject || permissions.canEdit || permissions.canCancel;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_REQUEST_STATUS_STYLES[request.status] ?? ""}`}>
          {PAYMENT_REQUEST_STATUS_LABELS[request.status] ?? request.status}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {PAYMENT_REQUEST_GROUP_LABELS[request.requestGroup]} · {def.label}
        </span>
        {request.routing === "DIRECT_TO_ACCOUNTANT" && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-500/10 dark:text-sky-400">
            Direct to accountant
          </span>
        )}
        {request.isOverdue && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
            Overdue
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {request.status === "REJECTED" && request.rejectionReason && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-500/10 dark:text-red-400">
          <span className="font-medium">Rejected by {request.rejectedBy?.fullName ?? "—"}:</span> {request.rejectionReason}
        </div>
      )}

      {(request.status === "APPROVED" || request.status === "PARTIALLY_PAID") && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-500/10 dark:text-blue-300">
          {permissions.payNotAvailableYet
            ? "Approved. Paying this request type from here is not available yet."
            : `Waiting for the accountant to pay ₹${formatCurrency(remaining)}.`}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Item label={def.payToLabel} value={request.payToName} />
        <Item label="Amount" value={`₹${formatCurrency(request.amount)}`} />
        <Item label="Paid" value={`₹${formatCurrency(request.paidAmount)}`} />
        <Item label="Payment Due Date" value={request.paymentDueDate.slice(0, 10)} />
        {def.showModeOfTransfer && <Item label="Mode of Transfer" value={request.modeOfTransfer ?? "—"} />}
        <Item label="Raised By" value={`${request.createdBy.fullName} · ${request.createdAt.slice(0, 10)}`} />
        <Item label="Approved By" value={request.approvedBy?.fullName ?? (request.routing === "DIRECT_TO_ACCOUNTANT" ? "Not needed" : "—")} />
        {request.cancelledBy && <Item label="Cancelled By" value={request.cancelledBy.fullName} />}
      </dl>

      {request.status === "PENDING_APPROVAL" && currentLevel && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          Waiting for level {request.currentApprovalLevel} of {request.requiredApprovalLevels} — approver: {currentApprovers}.
        </div>
      )}

      {(request.approvals.length > 0 || (plan && plan.levels.length > 1)) && (
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Approval history</p>
          {request.approvals.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">No decision yet.</p>
          ) : (
            <ol className="mt-2 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
              {request.approvals.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className={a.decision === "APPROVED" ? "font-medium text-green-700 dark:text-green-400" : "font-medium text-red-700 dark:text-red-400"}>
                    Level {a.level} {a.decision === "APPROVED" ? "approved" : "rejected"}
                  </span>{" "}
                  by {a.user.fullName} · {formatIstDateTime(a.decidedAt)}
                  {a.remark && <p className="text-zinc-600 dark:text-zinc-400">“{a.remark}”</p>}
                </li>
              ))}
            </ol>
          )}
          {request.routing !== "DIRECT_TO_ACCOUNTANT" && (
            <p className="mt-2 text-xs text-zinc-500">
              {plan?.ruleId ? "Approval Matrix rule applied." : "No matrix rule — default approval."}{" "}
              {request.approverMayPay ? "An approver may also pay it." : "An approver may not pay it."}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Remark</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">{request.remark || "—"}</p>
      </div>

      {hasActions && (
        <div className="flex flex-wrap gap-2">
          {permissions.canPay && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowPay(true)}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
            >
              Pay
            </button>
          )}
          {permissions.canApprove && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowApprove(true)}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Approve
            </button>
          )}
          {permissions.canReject && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowReject(true)}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              Reject
            </button>
          )}
          {permissions.canEdit && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setShowEdit(true)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Edit
            </button>
          )}
          {permissions.canCancel && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirm("cancel")}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel Request
            </button>
          )}
        </div>
      )}

      {request.payouts.length > 0 && (
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Payments made</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1 pr-4">Date</th>
                  <th className="py-1 pr-4">Amount</th>
                  <th className="py-1 pr-4">Paid from</th>
                  <th className="py-1 pr-4">Reference</th>
                  <th className="py-1 pr-4">Document</th>
                  <th className="py-1 pr-4">Journal</th>
                  <th className="py-1 pr-4">By</th>
                </tr>
              </thead>
              <tbody>
                {request.payouts.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1 pr-4">{p.paymentDate.slice(0, 10)}</td>
                    <td className="py-1 pr-4">₹{formatCurrency(p.amount)}</td>
                    <td className="py-1 pr-4">
                      {p.paymentType.name}
                      {p.bankAccount ? ` — ${p.bankAccount.name}` : ""}
                    </td>
                    <td className="py-1 pr-4">{p.referenceNumber ?? "—"}</td>
                    <td className="py-1 pr-4">
                      {p.payment ? (
                        <Link href={`/accounts/payments/${p.payment.id}`} className="text-indigo-600 hover:text-indigo-500">
                          {p.payment.paymentNumber}
                        </Link>
                      ) : p.internalTransfer ? (
                        <Link href={`/accounts/internal-transfers/${p.internalTransfer.id}`} className="text-indigo-600 hover:text-indigo-500">
                          {p.internalTransfer.transferNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-1 pr-4">
                      <Link href={`/accounts/journals/${p.journal.id}`} className="text-indigo-600 hover:text-indigo-500">
                        {p.journal.journalNumber}
                      </Link>
                    </td>
                    <td className="py-1 pr-4">{p.createdBy.fullName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AttachmentsPanel
        module="payment-request"
        recordId={request.id}
        canEdit={permissions.canEditFiles}
        title="Files & Voice Remarks"
        labelForContext={(c) => PAYMENT_REQUEST_STATUS_LABELS[c] ?? c}
      />

      <Modal open={showApprove} onClose={() => setShowApprove(false)} title="Approve request">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await runAction("approve", { remark: approveRemark })) setShowApprove(false);
          }}
        >
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Approve {request.requestNumber} for ₹{formatCurrency(request.amount)} to {request.payToName}
            {isLastLevel ? "? It will go to the accountant to pay." : ` at level ${request.currentApprovalLevel}? It then goes to the level ${request.currentApprovalLevel + 1} approvers.`}
          </p>
          <FormField label="Remark (optional)" htmlFor="approveRemark">
            <textarea
              id="approveRemark"
              rows={2}
              maxLength={1000}
              value={approveRemark}
              onChange={(e) => setApproveRemark(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowApprove(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Approve
            </button>
          </div>
        </form>
      </Modal>
      <ConfirmModal
        open={confirm === "cancel"}
        title="Cancel request?"
        message={`Cancel ${request.requestNumber}? This cannot be undone.`}
        confirmLabel="Cancel Request"
        cancelLabel="Keep"
        isDangerous
        isBusy={isBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await runAction("cancel")) setConfirm(null);
        }}
      />

      {showPay && (
        <PayoutModal
          open={showPay}
          requestId={request.id}
          requestNumber={request.requestNumber}
          remaining={remaining}
          fullOnly={FULL_PAYOUT_ONLY.includes(request.requestType)}
          isCashWithdrawal={request.requestType === "CASH_WITHDRAWAL"}
          onClose={() => setShowPay(false)}
          onPaid={() => {
            setShowPay(false);
            router.refresh();
          }}
        />
      )}

      <Modal open={showReject} onClose={() => setShowReject(false)} title="Reject request">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await runAction("reject", { rejectionReason })) setShowReject(false);
          }}
        >
          <FormField label="Reason" htmlFor="rejectionReason" required>
            <textarea
              id="rejectionReason"
              required
              rows={3}
              maxLength={1000}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowReject(false)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              Reject
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title={`Edit ${request.requestNumber}`} maxWidthClass="max-w-2xl">
        {showEdit && (
          <PaymentRequestForm
            requestType={request.requestType}
            initial={request}
            onCancel={() => setShowEdit(false)}
            onSuccess={() => {
              setShowEdit(false);
              router.refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/** Fixed locale + zone so server and browser render the same text (no hydration mismatch). */
function formatIstDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

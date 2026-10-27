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
import { PaymentRequestForm } from "../PaymentRequestForm";
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
}

interface Permissions {
  canApprove: boolean;
  canReject: boolean;
  canEdit: boolean;
  canCancel: boolean;
  canEditFiles: boolean;
}

export function PaymentRequestWorkflowPanel({ request, permissions }: { request: PaymentRequestDetail; permissions: Permissions }) {
  const router = useRouter();
  const def = PAYMENT_REQUEST_TYPE_DEFS[request.requestType];
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirm, setConfirm] = useState<"approve" | "cancel" | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showEdit, setShowEdit] = useState(false);

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

  const hasActions = permissions.canApprove || permissions.canReject || permissions.canEdit || permissions.canCancel;

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
          Waiting for the accountant to pay. Paying from this screen comes with the payout step.
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

      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Remark</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-50">{request.remark || "—"}</p>
      </div>

      {hasActions && (
        <div className="flex flex-wrap gap-2">
          {permissions.canApprove && (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirm("approve")}
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

      <AttachmentsPanel
        module="payment-request"
        recordId={request.id}
        canEdit={permissions.canEditFiles}
        title="Files & Voice Remarks"
        labelForContext={(c) => PAYMENT_REQUEST_STATUS_LABELS[c] ?? c}
      />

      <ConfirmModal
        open={confirm === "approve"}
        title="Approve request?"
        message={`Approve ${request.requestNumber} for ₹${formatCurrency(request.amount)} to ${request.payToName}? It will go to the accountant to pay.`}
        confirmLabel="Approve"
        isBusy={isBusy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await runAction("approve")) setConfirm(null);
        }}
      />
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

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-50">{value}</dd>
    </div>
  );
}

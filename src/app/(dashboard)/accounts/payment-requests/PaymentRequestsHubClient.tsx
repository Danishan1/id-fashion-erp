"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/currency";
import {
  PAYMENT_REQUEST_GROUPS,
  PAYMENT_REQUEST_GROUP_LABELS,
  PAYMENT_REQUEST_STATUS_LABELS,
  PAYMENT_REQUEST_TYPE_DEFS,
  typesOfGroup,
  type PaymentRequestGroupKey,
  type PaymentRequestTypeKey,
} from "@/modules/accounts/payment-requests/request-type-registry";
import { PaymentRequestForm } from "./PaymentRequestForm";
import { PAYMENT_REQUEST_STATUS_STYLES } from "./statusStyles";

interface PaymentRequestRow {
  id: string;
  requestNumber: string;
  requestType: PaymentRequestTypeKey;
  payToName: string;
  amount: string;
  paidAmount: string;
  paymentDueDate: string;
  status: string;
  isOverdue: boolean;
  createdBy: { fullName: string };
}

interface SummaryRow {
  group: PaymentRequestGroupKey;
  status: string;
  count: number;
}

type View = "all" | "mine" | "approve" | "pay";

interface Props {
  canCreate: boolean;
  canApprove: boolean;
  canPay: boolean;
  canViewMatrix: boolean;
}

export function PaymentRequestsHubClient({ canCreate, canApprove, canPay, canViewMatrix }: Props) {
  const router = useRouter();
  const [group, setGroup] = useState<PaymentRequestGroupKey | "">("");
  const [view, setView] = useState<View>("all");
  const [newType, setNewType] = useState<PaymentRequestTypeKey | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  useEffect(() => {
    fetch("/api/v1/payment-requests/summary")
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setSummary(body.data ?? []))
      .catch(() => {});
  }, [refreshKey]);

  const openCount = (g: PaymentRequestGroupKey) =>
    summary
      .filter((s) => s.group === g && ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_PAID"].includes(s.status))
      .reduce((sum, s) => sum + s.count, 0);

  const views: { key: View; label: string; show: boolean }[] = [
    { key: "all", label: "All", show: true },
    { key: "mine", label: "My Requests", show: true },
    { key: "approve", label: "To Approve", show: canApprove },
    { key: "pay", label: "To Pay", show: canPay },
  ];

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb items={[{ label: "Accounts", href: "/accounts" }, { label: "Payment Requests" }]} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Payment Requests</h1>
          {canViewMatrix && (
            <Link href="/accounts/payment-requests/approval-matrix" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
              Approval Matrix →
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Raise a request to pay money out. It goes to an approver (Salary goes straight to the accountant), and the
          accountant pays it. Add a remark or a voice remark on any request.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PAYMENT_REQUEST_GROUPS.map((g) => (
          <div
            key={g}
            className={`rounded-lg border p-3 ${
              group === g
                ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-500/10"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <button
              type="button"
              onClick={() => setGroup(group === g ? "" : g)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{PAYMENT_REQUEST_GROUP_LABELS[g]}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {openCount(g)} open
              </span>
            </button>
            <ul className="mt-2 space-y-1">
              {typesOfGroup(g).map((def) => (
                <li key={def.type} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">{def.label}</span>
                  {def.raisedFrom ? (
                    <a href={def.raisedFrom.href} className="shrink-0 text-xs text-zinc-500 hover:text-indigo-600" title={def.raisedFrom.label}>
                      From HRMS
                    </a>
                  ) : def.available ? (
                    canCreate && (
                      <button
                        type="button"
                        onClick={() => setNewType(def.type)}
                        className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      >
                        + New
                      </button>
                    )
                  ) : (
                    <span className="shrink-0 text-xs text-zinc-400" title={`Planned: ${def.skill}`}>
                      Coming soon
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {views
          .filter((v) => v.show)
          .map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                view === v.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"
              }`}
            >
              {v.label}
            </button>
          ))}
        {group && (
          <span className="ml-auto self-center text-xs text-zinc-500">
            Showing {PAYMENT_REQUEST_GROUP_LABELS[group]} only ·{" "}
            <button type="button" onClick={() => setGroup("")} className="text-indigo-600 hover:text-indigo-500">
              show all
            </button>
          </span>
        )}
      </div>

      <DataTable<PaymentRequestRow>
        fetchUrl="/api/v1/payment-requests"
        refreshKey={refreshKey}
        extraParams={{ group: group || undefined, view: view === "all" ? undefined : view }}
        searchPlaceholder="Search by request number or pay-to…"
        rowHref={(row) => `/accounts/payment-requests/${row.id}`}
        statusFilter={{
          options: Object.entries(PAYMENT_REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label })),
        }}
        columns={[
          { key: "requestNumber", header: "Request No.", sortable: true },
          { key: "requestType", header: "Type", render: (row) => PAYMENT_REQUEST_TYPE_DEFS[row.requestType]?.label ?? row.requestType },
          { key: "payToName", header: "Pay To", sortable: true },
          { key: "amount", header: "Amount", sortable: true, render: (row) => `₹${formatCurrency(row.amount)}` },
          {
            key: "paymentDueDate",
            header: "Due",
            sortable: true,
            render: (row) => (
              <span className={row.isOverdue ? "font-medium text-red-600 dark:text-red-400" : ""}>
                {row.paymentDueDate.slice(0, 10)}
                {row.isOverdue && " · Overdue"}
              </span>
            ),
          },
          { key: "createdBy", header: "Raised By", render: (row) => row.createdBy.fullName },
          {
            key: "status",
            header: "Status",
            sortable: true,
            render: (row) => (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_REQUEST_STATUS_STYLES[row.status] ?? ""}`}>
                {PAYMENT_REQUEST_STATUS_LABELS[row.status] ?? row.status}
              </span>
            ),
          },
        ]}
      />

      <Modal
        open={newType !== null}
        onClose={() => setNewType(null)}
        title={newType ? PAYMENT_REQUEST_TYPE_DEFS[newType].label : ""}
        maxWidthClass="max-w-2xl"
      >
        {newType && (
          <PaymentRequestForm
            key={newType}
            requestType={newType}
            onCancel={() => setNewType(null)}
            onSuccess={(id) => {
              setNewType(null);
              setRefreshKey((k) => k + 1);
              router.push(`/accounts/payment-requests/${id}`);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

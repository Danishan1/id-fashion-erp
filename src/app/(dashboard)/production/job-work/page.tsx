"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DataTable } from "@/components/ui/DataTable";
import { JOB_WORK_ORDER_STATUS_LABELS, JOB_WORK_ORDER_STATUS_BADGE_CLASS } from "../../production-orders/statusLabels";

type JobWorkStatus = keyof typeof JOB_WORK_ORDER_STATUS_LABELS;

interface JobWorkOrderRow {
  id: string;
  jobWorkNumber: string;
  supplier: { id: string; name: string };
  jobOrder: { jobNumber: string; lot: { lotNumber: string; productionOrder: { orderNumber: string } } };
  issuedQuantity: string;
  receivedQuantity: string;
  rejectedQuantity: string;
  damagedQuantity: string;
  status: JobWorkStatus;
  issueDate: string;
  expectedCompletionDate: string | null;
  metrics: { pendingQuantity: number; daysElapsed: number; isOverdue: boolean };
}

interface SupplierOption {
  id: string;
  name: string;
}

export default function JobWorkOrderListPage() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  useEffect(() => {
    fetch("/api/v1/suppliers?pageSize=200")
      .then((res) => res.json())
      .then((body) => setSuppliers(body.data ?? []));
  }, []);

  const params = new URLSearchParams();
  if (supplierId) params.set("supplierId", supplierId);
  if (overdueOnly) params.set("overdueOnly", "true");
  const fetchUrl = `/api/v1/job-work-orders${params.toString() ? `?${params.toString()}` : ""}`;
  const exportUrl = `/api/v1/job-work-orders/export/xlsx${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Job Work Orders" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Job Work Orders</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Every unit of production work currently sent to an external contractor — what&apos;s outside, which
            vendor has it, how much is pending, and how many days it&apos;s been out. Started from a Job Order&apos;s
            own &ldquo;Send to Job-Work&rdquo; action.
          </p>
        </div>
        <a
          href={exportUrl}
          className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Download Excel
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">All Contractors</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
      </div>

      <DataTable<JobWorkOrderRow>
        key={`${supplierId}|${overdueOnly}`}
        fetchUrl={fetchUrl}
        searchPlaceholder="Search by job-work #…"
        rowHref={(row) => `/production/job-work/${row.id}`}
        columns={[
          { key: "jobWorkNumber", header: "Job-Work #" },
          { key: "supplier", header: "Contractor", render: (row) => row.supplier.name },
          {
            key: "jobOrder",
            header: "Lot / Job Order",
            render: (row) => `${row.jobOrder.lot.productionOrder.orderNumber} / ${row.jobOrder.lot.lotNumber} — ${row.jobOrder.jobNumber}`,
          },
          { key: "issuedQuantity", header: "Issued", render: (row) => row.issuedQuantity },
          { key: "receivedQuantity", header: "Received", render: (row) => row.receivedQuantity },
          { key: "pending", header: "Pending", render: (row) => row.metrics.pendingQuantity },
          { key: "daysElapsed", header: "Days Elapsed", render: (row) => row.metrics.daysElapsed },
          {
            key: "status",
            header: "Status",
            render: (row) => (
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${JOB_WORK_ORDER_STATUS_BADGE_CLASS[row.status]}`}>
                  {JOB_WORK_ORDER_STATUS_LABELS[row.status]}
                </span>
                {row.metrics.isOverdue && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">
                    Overdue
                  </span>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

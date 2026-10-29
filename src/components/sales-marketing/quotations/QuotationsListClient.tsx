"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { textInputClass } from "@/components/ui/FormField";
import { formatDate } from "@/lib/date-format";
import { QUOTATION_STATUSES, QUOTATION_STATUS_KEYS, type QuotationStatus } from "@/modules/sales-marketing/quotations/quotation-registry";
import { QuotationStatusBadge, formatInr } from "./QuotationStatusBadge";

interface QuotationRow {
  id: string;
  quotationNumber: string;
  createdAt: string;
  status: QuotationStatus;
  prospectName: string | null;
  customer: { name: string } | null;
  owner: { fullName: string } | null;
  buyerEnquiry: { id: string; enquiryNumber: string } | null;
  current: { revisionNumber: number; title: string; validUntil: string; grandTotal: string } | null;
  isExpired: boolean;
}

type View = "open" | "closed" | "all";
const selectClass = `${textInputClass()} !w-auto min-w-[9rem]`;

export function QuotationsListClient({ viewAll }: { viewAll: boolean }) {
  const [view, setView] = useState<View>("open");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const statusOptions = QUOTATION_STATUS_KEYS.filter((s) => (view === "all" ? true : view === "open" ? QUOTATION_STATUSES[s].open : !QUOTATION_STATUSES[s].open));

  return (
    <DataTable<QuotationRow>
      fetchUrl="/api/v1/sales-marketing/quotations"
      searchPlaceholder="Search number, title, customer, prospect or enquiry…"
      rowHref={(row) => `/sales-marketing/quotations/${row.id}`}
      initialSort={{ sortBy: "createdAt", sortOrder: "desc" }}
      extraParams={{ view, status: status || undefined, owner: owner || undefined }}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Quotation view">
            {(["open", "closed", "all"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setView(v);
                  setStatus("");
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium capitalize ${view === v ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="">All statuses</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {QUOTATION_STATUSES[s].label}
              </option>
            ))}
          </select>
          <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={selectClass}>
            <option value="">{viewAll ? "Any owner" : "Mine & my team"}</option>
            <option value="me">Owned by me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
      }
      columns={[
        {
          key: "quotationNumber",
          header: "Quotation",
          sortable: true,
          render: (row) => (
            <div className="min-w-0">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {row.quotationNumber}
                {row.current && row.current.revisionNumber > 1 && <span className="ml-1 text-xs text-zinc-500">rev {row.current.revisionNumber}</span>}
              </div>
              {row.current?.title && <div className="max-w-xs truncate text-xs text-zinc-500 dark:text-zinc-400">{row.current.title}</div>}
            </div>
          ),
        },
        {
          key: "party",
          header: "Customer / prospect",
          render: (row) => (
            <div>
              <div>{row.customer?.name ?? row.prospectName ?? "—"}</div>
              {!row.customer && row.prospectName && <div className="text-xs text-amber-600 dark:text-amber-400">Prospect</div>}
            </div>
          ),
        },
        { key: "enquiry", header: "Enquiry", render: (row) => row.buyerEnquiry?.enquiryNumber ?? "—" },
        {
          key: "status",
          header: "Status",
          sortable: true,
          render: (row) => (
            <div className="flex flex-col items-start gap-0.5">
              <QuotationStatusBadge status={row.status} />
              {row.isExpired && <span className="text-xs font-medium text-red-600 dark:text-red-400">Expired</span>}
            </div>
          ),
        },
        { key: "owner", header: "Owner", render: (row) => row.owner?.fullName ?? <span className="text-zinc-400">Unassigned</span> },
        { key: "grandTotal", header: "Total", render: (row) => <span className="tabular-nums">{formatInr(row.current?.grandTotal)}</span> },
        { key: "validUntil", header: "Valid until", render: (row) => (row.current ? formatDate(row.current.validUntil) : "—") },
        { key: "createdAt", header: "Created", sortable: true, render: (row) => formatDate(row.createdAt) },
      ]}
    />
  );
}

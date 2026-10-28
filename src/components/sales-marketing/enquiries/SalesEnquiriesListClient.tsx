"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { textInputClass } from "@/components/ui/FormField";
import { formatDate } from "@/lib/date-format";
import {
  ENQUIRY_SOURCES,
  ENQUIRY_SOURCE_KEYS,
  SALES_ENQUIRY_PRIORITIES,
  SALES_ENQUIRY_PRIORITY_KEYS,
  SALES_ENQUIRY_STAGES,
  SALES_ENQUIRY_STAGE_KEYS,
  type SalesEnquiryPriority,
  type SalesEnquiryStage,
} from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";
import { useEnquiryOwners } from "./SalesEnquiryFields";
import { PriorityBadge, StageBadge } from "./SalesEnquiryBadges";

interface SalesEnquiryRow {
  id: string;
  enquiryNumber: string;
  subject: string | null;
  enquiryDate: string;
  salesStage: SalesEnquiryStage;
  status: string;
  priority: SalesEnquiryPriority;
  nextFollowUpDate: string | null;
  isOverdue: boolean;
  prospectName: string | null;
  customer: { name: string } | null;
  crmCompany: { name: string } | null;
  owner: { fullName: string } | null;
  _count: { lines: number };
}

type View = "open" | "closed" | "all";
const VIEWS: { key: View; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const selectClass = `${textInputClass()} !w-auto min-w-[9rem]`;

export function SalesEnquiriesListClient({ viewAll }: { viewAll: boolean }) {
  const [view, setView] = useState<View>("open");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [overdue, setOverdue] = useState(false);
  const owners = useEnquiryOwners(viewAll);

  const stageOptions = SALES_ENQUIRY_STAGE_KEYS.filter((s) =>
    view === "all" ? true : view === "closed" ? SALES_ENQUIRY_STAGES[s].closed : !SALES_ENQUIRY_STAGES[s].closed
  );

  return (
    <DataTable<SalesEnquiryRow>
      fetchUrl="/api/v1/sales-marketing/enquiries"
      searchPlaceholder="Search number, subject, customer, prospect or CRM contact…"
      rowHref={(row) => `/sales-marketing/enquiries/${row.id}`}
      initialSort={{ sortBy: "enquiryDate", sortOrder: "desc" }}
      extraParams={{
        view,
        stage: stage || undefined,
        owner: owner || undefined,
        priority: priority || undefined,
        source: source || undefined,
        overdue: overdue ? "1" : undefined,
      }}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Enquiry view">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => {
                  setView(v.key);
                  setStage("");
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  view === v.key ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <select aria-label="Stage" value={stage} onChange={(e) => setStage(e.target.value)} className={selectClass}>
            <option value="">All stages</option>
            {stageOptions.map((s) => (
              <option key={s} value={s}>
                {SALES_ENQUIRY_STAGES[s].label}
              </option>
            ))}
          </select>
          <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={selectClass}>
            <option value="">{viewAll ? "Any owner" : "Mine & my team"}</option>
            <option value="me">Owned by me</option>
            <option value="unassigned">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
              </option>
            ))}
          </select>
          <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={selectClass}>
            <option value="">Any priority</option>
            {SALES_ENQUIRY_PRIORITY_KEYS.map((p) => (
              <option key={p} value={p}>
                {SALES_ENQUIRY_PRIORITIES[p].label}
              </option>
            ))}
          </select>
          <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)} className={selectClass}>
            <option value="">Any source</option>
            {ENQUIRY_SOURCE_KEYS.map((s) => (
              <option key={s} value={s}>
                {ENQUIRY_SOURCES[s]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
            <input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
            Overdue follow-ups
          </label>
        </div>
      }
      columns={[
        {
          key: "enquiryNumber",
          header: "Enquiry",
          sortable: true,
          render: (row) => (
            <div className="min-w-0">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{row.enquiryNumber}</div>
              {row.subject && <div className="max-w-xs truncate text-xs text-zinc-500 dark:text-zinc-400">{row.subject}</div>}
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
              {row.crmCompany && row.crmCompany.name !== row.customer?.name && (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">CRM: {row.crmCompany.name}</div>
              )}
            </div>
          ),
        },
        {
          key: "salesStage",
          header: "Stage",
          sortable: true,
          render: (row) => (
            <div className="flex flex-col items-start gap-0.5">
              <StageBadge stage={row.salesStage} />
              {row.status === "CANCELLED" && <span className="text-xs text-red-600 dark:text-red-400">Cancelled in Merchandising</span>}
            </div>
          ),
        },
        { key: "priority", header: "Priority", sortable: true, render: (row) => <PriorityBadge priority={row.priority} /> },
        { key: "owner", header: "Owner", render: (row) => row.owner?.fullName ?? <span className="text-zinc-400">Unassigned</span> },
        {
          key: "nextFollowUpDate",
          header: "Next follow-up",
          sortable: true,
          render: (row) =>
            row.nextFollowUpDate ? (
              <span className={row.isOverdue ? "font-medium text-red-600 dark:text-red-400" : ""}>
                {formatDate(row.nextFollowUpDate)}
                {row.isOverdue && " · overdue"}
              </span>
            ) : (
              "—"
            ),
        },
        { key: "lines", header: "Lines", render: (row) => row._count.lines },
        { key: "enquiryDate", header: "Received", sortable: true, render: (row) => formatDate(row.enquiryDate) },
      ]}
    />
  );
}

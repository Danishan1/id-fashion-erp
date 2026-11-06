"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { textInputClass } from "@/components/ui/FormField";
import { formatDate } from "@/lib/date-format";
import { PRICE_LIST_VERSION_STATUSES, type PriceListVersionStatusKey } from "@/modules/sales-marketing/pricing/pricing-registry";
import { Badge } from "./pricing-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  kind: "DEFAULT" | "CUSTOMER";
  kindLabel: string;
  priority: number;
  active: boolean;
  customer: { name: string } | null;
  inForce: { versionNumber: number; effectiveFrom: string; effectiveTo: string | null; entries: number } | null;
  scheduled: { versionNumber: number; effectiveFrom: string } | null;
  open: { versionNumber: number; status: PriceListVersionStatusKey } | null;
}

const selectClass = `${textInputClass()} !w-auto min-w-[9rem]`;

export function PriceListsListClient() {
  const [status, setStatus] = useState("active");
  const [kind, setKind] = useState("");
  return (
    <DataTable<Row>
      fetchUrl="/api/v1/sales-marketing/pricing/price-lists"
      searchPlaceholder="Search code, name or customer…"
      rowHref={(row) => `/sales-marketing/pricing/${row.id}`}
      extraParams={{ status, kind: kind || undefined }}
      toolbar={
        <div className="flex flex-wrap gap-2">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="active">Active lists</option>
            <option value="pending">Waiting for approval</option>
            <option value="inactive">Inactive lists</option>
            <option value="all">All</option>
          </select>
          <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={selectClass}>
            <option value="">Default & customer</option>
            <option value="DEFAULT">Default</option>
            <option value="CUSTOMER">Customer</option>
          </select>
        </div>
      }
      columns={[
        {
          key: "code",
          header: "Price list",
          render: (r) => (
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.code}</div>
              <div className="text-xs text-zinc-500">{r.name}</div>
            </div>
          ),
        },
        { key: "kind", header: "For", render: (r) => (r.kind === "CUSTOMER" ? (r.customer?.name ?? "Customer") : "Everyone (default)") },
        { key: "priority", header: "Priority", render: (r) => r.priority },
        {
          key: "inForce",
          header: "In force",
          render: (r) =>
            r.inForce ? (
              <div>
                <div>
                  v{r.inForce.versionNumber} · {r.inForce.entries} price{r.inForce.entries === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-zinc-500">
                  from {formatDate(r.inForce.effectiveFrom)}
                  {r.inForce.effectiveTo ? ` to ${formatDate(r.inForce.effectiveTo)}` : ""}
                </div>
              </div>
            ) : (
              <span className="text-zinc-400">No approved prices today</span>
            ),
        },
        {
          key: "next",
          header: "Coming",
          render: (r) => (
            <div className="flex flex-col items-start gap-1">
              {r.scheduled && <Badge tone="indigo">v{r.scheduled.versionNumber} from {formatDate(r.scheduled.effectiveFrom)}</Badge>}
              {r.open && <Badge tone={r.open.status === "PENDING_APPROVAL" ? "amber" : "zinc"}>v{r.open.versionNumber} {PRICE_LIST_VERSION_STATUSES[r.open.status].toLowerCase()}</Badge>}
              {!r.scheduled && !r.open && <span className="text-zinc-400">—</span>}
            </div>
          ),
        },
        { key: "active", header: "Status", render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
      ]}
    />
  );
}

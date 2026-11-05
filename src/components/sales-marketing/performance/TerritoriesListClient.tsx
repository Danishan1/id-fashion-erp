"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { Badge, selectClass } from "./performance-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  active: boolean;
  customers: number;
  primaryRep: string | null;
  reps: string[];
}

/** Sales & Marketing → Territories list (Phase 05). */
export function TerritoriesListClient() {
  const [status, setStatus] = useState("active");
  return (
    <DataTable<Row>
      fetchUrl="/api/v1/sales-marketing/performance/territories"
      searchPlaceholder="Search code or name…"
      rowHref={(row) => `/sales-marketing/territories/${row.id}`}
      extraParams={{ status }}
      toolbar={
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      }
      columns={[
        {
          key: "code",
          header: "Territory",
          render: (r) => (
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
              <div className="text-xs text-zinc-500">{r.code}</div>
            </div>
          ),
        },
        { key: "primaryRep", header: "Primary rep", render: (r) => r.primaryRep ?? <span className="text-zinc-400">None today</span> },
        { key: "reps", header: "Reps today", render: (r) => (r.reps.length ? r.reps.join(", ") : <span className="text-zinc-400">—</span>) },
        { key: "customers", header: "Customers", render: (r) => r.customers.toLocaleString("en-IN") },
        { key: "active", header: "Status", render: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
      ]}
    />
  );
}

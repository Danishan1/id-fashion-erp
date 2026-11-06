"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { RUN_STATUSES, type RunStatusKey } from "@/modules/sales-marketing/delivery/delivery-registry";
import { selectClass } from "../performance/performance-ui";
import { CHANNEL_LABELS, RunStatusBadge, fmtCount, fmtDateTime } from "./delivery-ui";

interface Row {
  id: string;
  runNumber: number;
  channelType: string;
  providerLabel: string;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
  finishedAt: string | null;
  plannedCount: number;
  campaign: { code: string; name: string };
  connectionName: string;
  counts: { accepted: number; delivered: number; failed: number; unknown: number; excluded: number; pending: number };
}

/** Sales & Marketing → Delivery Runs (Phase 10). */
export function RunsClient() {
  const [status, setStatus] = useState("");
  return (
    <DataTable<Row>
      fetchUrl="/api/v1/sales-marketing/delivery/runs"
      hideSearch
      rowHref={(r) => `/sales-marketing/delivery/runs/${r.id}`}
      extraParams={{ status }}
      toolbar={
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="">Any status</option>
          {(Object.keys(RUN_STATUSES) as RunStatusKey[]).map((k) => (
            <option key={k} value={k}>
              {RUN_STATUSES[k].label}
            </option>
          ))}
        </select>
      }
      columns={[
        {
          key: "campaign",
          header: "Campaign · run",
          render: (r) => (
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.campaign.name}</div>
              <div className="text-xs text-zinc-500">
                {r.campaign.code} · run #{r.runNumber}
              </div>
            </div>
          ),
        },
        { key: "channel", header: "Channel", render: (r) => `${CHANNEL_LABELS[r.channelType] ?? r.channelType} · ${r.connectionName}` },
        { key: "status", header: "Status", render: (r) => <RunStatusBadge status={r.status} /> },
        {
          key: "counts",
          header: "Accepted / failed / unknown / not sent",
          render: (r) => (
            <span className="text-sm">
              {fmtCount(r.counts.accepted)} / {fmtCount(r.counts.failed)} / {fmtCount(r.counts.unknown)} / {fmtCount(r.counts.excluded)}
              {r.counts.pending ? <span className="text-zinc-500"> · {fmtCount(r.counts.pending)} pending</span> : null}
            </span>
          ),
        },
        { key: "when", header: "When", render: (r) => fmtDateTime(r.finishedAt ?? r.scheduledFor ?? r.createdAt) },
      ]}
    />
  );
}

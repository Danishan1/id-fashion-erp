"use client";

import { useState } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { SEGMENT_SOURCE_KEYS, SEGMENT_SOURCES, SEGMENT_STATUSES, SEGMENT_STATUS_KEYS, SEGMENT_TYPES } from "@/modules/sales-marketing/segments/segment-registry";
import { selectClass } from "../performance/performance-ui";
import { EvaluationBadge, SegmentStatusBadge, fmtCount, fmtDateTime, sourceLabel } from "./segment-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  segmentType: "DYNAMIC" | "STATIC";
  status: string;
  owner: string;
  memberCount: number | null;
  lastEvaluatedAt: string | null;
  lastEvaluationStatus: string | null;
  currentVersionNumber: number;
}

/** Sales & Marketing → Audience Segments list (Phase 09). */
export function SegmentsClient() {
  const [status, setStatus] = useState("DRAFT,ACTIVE,PAUSED");
  const [sourceType, setSource] = useState("");
  const [segmentType, setType] = useState("");
  return (
    <DataTable<Row>
      fetchUrl="/api/v1/sales-marketing/segments"
      searchPlaceholder="Search code or name…"
      rowHref={(r) => `/sales-marketing/segments/${r.id}`}
      extraParams={{ status, sourceType, segmentType }}
      toolbar={
        <div className="flex flex-wrap gap-2">
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="DRAFT,ACTIVE,PAUSED">Not archived</option>
            <option value="">Any status</option>
            {SEGMENT_STATUS_KEYS.map((k) => (
              <option key={k} value={k}>
                {SEGMENT_STATUSES[k].label}
              </option>
            ))}
          </select>
          <select aria-label="Record type" value={sourceType} onChange={(e) => setSource(e.target.value)} className={selectClass}>
            <option value="">Any record type</option>
            {SEGMENT_SOURCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SEGMENT_SOURCES[k].label}
              </option>
            ))}
          </select>
          <select aria-label="Segment type" value={segmentType} onChange={(e) => setType(e.target.value)} className={selectClass}>
            <option value="">Dynamic and static</option>
            <option value="DYNAMIC">Dynamic</option>
            <option value="STATIC">Static</option>
          </select>
        </div>
      }
      columns={[
        {
          key: "code",
          header: "Segment",
          render: (r) => (
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.name}</div>
              <div className="text-xs text-zinc-500">
                {r.code} · v{r.currentVersionNumber}
              </div>
            </div>
          ),
        },
        { key: "sourceType", header: "Records", render: (r) => sourceLabel(r.sourceType) },
        { key: "segmentType", header: "Type", render: (r) => SEGMENT_TYPES[r.segmentType].label },
        { key: "owner", header: "Owner", render: (r) => r.owner },
        {
          key: "memberCount",
          header: "Members (last snapshot)",
          render: (r) => (
            <div className="text-sm">
              <div className="tabular-nums">{fmtCount(r.memberCount)}</div>
              <div className="text-xs text-zinc-500">{fmtDateTime(r.lastEvaluatedAt)}</div>
            </div>
          ),
        },
        { key: "lastEvaluationStatus", header: "Last refresh", render: (r) => <EvaluationBadge status={r.lastEvaluationStatus} /> },
        { key: "status", header: "Status", render: (r) => <SegmentStatusBadge status={r.status} /> },
      ]}
    />
  );
}

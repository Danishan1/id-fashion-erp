"use client";

import { useEffect, useState } from "react";
import { EVALUATION_STATUSES, SEGMENT_SOURCES, SEGMENT_STATUSES, type EvaluationStatusKey, type LookupKey, type SegmentSourceKey, type SegmentStatusKey } from "@/modules/sales-marketing/segments/segment-registry";
import { Badge } from "../pricing/pricing-ui";

/** Shared bits of the Phase 09 segment screens. */

export { Badge, CARD } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";

export function SegmentStatusBadge({ status }: { status: string }) {
  const s = SEGMENT_STATUSES[status as SegmentStatusKey];
  return <Badge tone={s?.tone ?? "zinc"}>{s?.label ?? status}</Badge>;
}
export function EvaluationBadge({ status }: { status: string | null }) {
  if (!status) return <Badge tone="zinc">Not evaluated</Badge>;
  const s = EVALUATION_STATUSES[status as EvaluationStatusKey];
  return <Badge tone={s?.tone ?? "zinc"}>{s?.label ?? status}</Badge>;
}
export const sourceLabel = (s: string) => SEGMENT_SOURCES[s as SegmentSourceKey]?.label ?? s;

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—";
export const fmtCount = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-IN"));

export const CONSENT_TEXT: Record<string, { tone: "green" | "amber" | "zinc"; text: string }> = {
  VERIFIED: { tone: "green", text: "Consent checked against CRM contact opt-outs for this channel." },
  NOT_AVAILABLE: { tone: "amber", text: "Consent can't be verified for this record type — the audience is not cleared for marketing messages." },
  NOT_CHECKED: { tone: "zinc", text: "No channel chosen — address and consent aren't checked. Being in a segment is not permission to contact." },
};

export type LookupOptions = Partial<Record<LookupKey, { value: string; label: string }[]>>;

/** Option lists for a source's lookup fields (users, statuses, tags…). */
export function useFieldOptions(source: SegmentSourceKey | null) {
  const [data, setData] = useState<{ source: SegmentSourceKey | null; options: LookupOptions }>({ source: null, options: {} });
  useEffect(() => {
    if (!source) return;
    let alive = true;
    fetch(`/api/v1/sales-marketing/segments/options?source=${source}`, { headers: { "x-toast": "off" } })
      .then((r) => (r.ok ? r.json() : { data: {} }))
      .then((b) => alive && setData({ source, options: b.data ?? {} }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [source]);
  return data.source === source ? data.options : {};
}

export interface RecordRow {
  id: string;
  name: string;
  organization: string | null;
  status: string | null;
  owner: string | null;
  location: string | null;
  href: string;
}

export const REASON_LABELS: Record<string, string> = {
  MANUAL_EXCLUSION: "Excluded by hand",
  EXCLUSION_RULE: "Exclusion rule",
  CONSENT_RESTRICTED: "Opted out / DNC",
  NO_ADDRESS: "No address for channel",
  NOT_ACCESSIBLE: "Not accessible",
  SOURCE_UNAVAILABLE: "Archived / deleted",
};

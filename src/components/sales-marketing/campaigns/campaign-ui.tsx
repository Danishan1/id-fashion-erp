"use client";

import { useEffect, useState } from "react";
import { CAMPAIGN_STATUSES, type CampaignStatusKey } from "@/modules/sales-marketing/campaigns/campaign-registry";
import { Badge } from "../pricing/pricing-ui";

/** Shared bits of the Phase 08 campaign screens. */

export { Badge, CARD, TextDialog, inr, type TextDialogSpec } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";

export function StatusBadge({ status }: { status: string }) {
  const s = CAMPAIGN_STATUSES[status as CampaignStatusKey];
  return <Badge tone={s?.tone ?? "zinc"}>{s?.label ?? status}</Badge>;
}

export interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

/** Types, objectives, departments, sales channels and possible owners for the campaign form / filters. */
export function useCampaignLookups(enabled = true) {
  const [data, setData] = useState<{ types: Option[]; objectives: Option[]; departments: Option[]; channels: Option[]; owners: Option[] }>({ types: [], objectives: [], departments: [], channels: [], owners: [] });
  useEffect(() => {
    if (!enabled) return;
    const opts = { headers: { "x-toast": "off" } };
    const get = (url: string) => fetch(url, opts).then((r) => (r.ok ? r.json() : { data: [] })).then((b) => b.data ?? []);
    Promise.all([get("/api/v1/sales-marketing/campaigns/lookups"), get("/api/v1/departments"), get("/api/v1/sales-marketing/channels/options"), get("/api/v1/sales-marketing/performance/reps")])
      .then(([lookups, departments, channelOpts, reps]) => {
        const l = lookups as { id: string; kind: string; name: string; code: string }[];
        setData({
          types: l.filter((x) => x.kind === "TYPE").map((x) => ({ id: x.id, label: x.name, sublabel: x.code })),
          objectives: l.filter((x) => x.kind === "OBJECTIVE").map((x) => ({ id: x.id, label: x.name, sublabel: x.code })),
          departments: ((Array.isArray(departments) ? departments : []) as { id: string; name: string; isActive?: boolean }[]).map((d) => ({ id: d.id, label: d.name })),
          channels: ((channelOpts as { channels?: { id: string; name: string; code: string }[] }).channels ?? []).map((c) => ({ id: c.id, label: c.name, sublabel: c.code })),
          owners: (reps as { id: string; fullName: string }[]).map((u) => ({ id: u.id, label: u.fullName })),
        });
      })
      .catch(() => undefined);
  }, [enabled]);
  return data;
}

export const dateRange = (from: string, to: string | null) => `${from}${to ? ` → ${to}` : ""}`;

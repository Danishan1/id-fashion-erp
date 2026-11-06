"use client";

import { DELIVERY_STATUSES, RUN_STATUSES, SKIP_REASONS, type DeliveryStatusKey, type RunStatusKey, type SkipReasonKey } from "@/modules/sales-marketing/delivery/delivery-registry";
import { Badge } from "../pricing/pricing-ui";

/** Shared bits of the Phase 10 delivery screens. */

export { Badge, CARD } from "../pricing/pricing-ui";
export { send, useApi } from "../commissions/commission-ui";
export { fmtCount, fmtDateTime } from "../segments/segment-ui";

type Tone = "zinc" | "green" | "amber" | "indigo" | "red";
const toTone = (t: string): Tone => (t === "blue" ? "indigo" : (t as Tone));

export function RunStatusBadge({ status }: { status: string }) {
  const s = RUN_STATUSES[status as RunStatusKey];
  return <Badge tone={toTone(s?.tone ?? "zinc")}>{s?.label ?? status}</Badge>;
}

export function DeliveryStatusBadge({ status }: { status: string }) {
  const s = DELIVERY_STATUSES[status as DeliveryStatusKey];
  return (
    <span title={s?.help}>
      <Badge tone={toTone(s?.tone ?? "zinc")}>{s?.label ?? status}</Badge>
    </span>
  );
}

/** Integrations built against provider documentation, never run against a real account yet. */
export function NotLiveVerifiedBadge({ liveVerified }: { liveVerified: boolean }) {
  if (liveVerified) return null;
  return (
    <span title="Built from the provider's documentation and tested with mocks only. Send a test message before a real campaign.">
      <Badge tone="amber">Not live-verified</Badge>
    </span>
  );
}

export const skipReasonLabel = (k: string | null) => (k ? (SKIP_REASONS[k as SkipReasonKey] ?? k) : "—");

export const CHANNEL_LABELS: Record<string, string> = { EMAIL: "Email", SMS: "SMS", WHATSAPP: "WhatsApp" };

export function newIdempotencyKey() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

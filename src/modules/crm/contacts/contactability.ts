import {
  CONTACTABILITY_CHANNEL_KEYS,
  CONTACTABILITY_SEVERITY,
  type ContactabilityChannel,
  type ContactabilityStatus,
} from "./contact-registry";

/**
 * Pure contactability rules (client-safe). The one question every sending
 * feature asks — campaigns, sequences, the inbox, telephony, workflows:
 *
 *   canContact(contact.consents, "WHATSAPP") → { allowed: false, reason, … }
 *
 * A contact-wide "ALL" restriction overrides every channel; otherwise the
 * channel's own row decides; no row means allowed.
 */
export interface ConsentRow {
  channel: string;
  status: ContactabilityStatus;
  reason?: string | null;
  source?: string | null;
  changedAt?: Date | string | null;
}

export interface ContactabilityDecision {
  allowed: boolean;
  /** Status that decided (ALLOWED when nothing restricts the channel). */
  status: ContactabilityStatus;
  /** "ALL" when a contact-wide restriction decided. */
  decidedBy: ContactabilityChannel | null;
  reason: string | null;
}

export function canContact(consents: ConsentRow[], channel: Exclude<ContactabilityChannel, "ALL">): ContactabilityDecision {
  const all = consents.find((c) => c.channel === "ALL");
  if (all && all.status !== "ALLOWED") return { allowed: false, status: all.status, decidedBy: "ALL", reason: all.reason ?? null };
  const own = consents.find((c) => c.channel === channel);
  if (own && own.status !== "ALLOWED") return { allowed: false, status: own.status, decidedBy: channel, reason: own.reason ?? null };
  return { allowed: true, status: "ALLOWED", decidedBy: own ? channel : null, reason: null };
}

/** Per-channel summary for the UI (every channel, restricted or not). */
export function contactabilitySummary(consents: ConsentRow[]) {
  return CONTACTABILITY_CHANNEL_KEYS.map((channel) => {
    const row = consents.find((c) => c.channel === channel) ?? null;
    const effective = channel === "ALL" ? { allowed: !row || row.status === "ALLOWED", status: row?.status ?? "ALLOWED" } : canContact(consents, channel);
    return { channel, row, allowed: effective.allowed, effectiveStatus: effective.status as ContactabilityStatus };
  });
}

/** Merge rule: for every channel the stricter of the two statuses wins (never silently re-allow contact). */
export function mergeConsents(survivor: ConsentRow[], merged: ConsentRow[]): { channel: string; keep: "survivor" | "merged" }[] {
  const channels = new Set([...survivor.map((c) => c.channel), ...merged.map((c) => c.channel)]);
  const out: { channel: string; keep: "survivor" | "merged" }[] = [];
  for (const channel of channels) {
    const a = survivor.find((c) => c.channel === channel);
    const b = merged.find((c) => c.channel === channel);
    if (!b) continue;
    if (!a || CONTACTABILITY_SEVERITY[b.status] > CONTACTABILITY_SEVERITY[a.status]) out.push({ channel, keep: "merged" });
  }
  return out;
}

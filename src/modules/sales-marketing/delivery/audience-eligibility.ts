import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { canContact } from "@/modules/crm/contacts/contactability";
import { MARKETING_CHANNELS, type ConsentPolicyKey, type MarketingChannelKey, type SkipReasonKey } from "./delivery-registry";
import type { MarketingProviderAdapter } from "./providers/provider-contract";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Audience resolution and recipient eligibility (Phase 10) — the one place
 * delivery decides who may be messaged. Uses the campaign's Phase 09
 * audience (include / exclude segments, each pinned or its latest snapshot),
 * never a live re-evaluation, and Phase 04 contact consents.
 */

export interface ResolvedAudience {
  /** What was used — frozen on the run. */
  segments: { segmentId: string; code: string; role: "INCLUDE" | "EXCLUDE"; evaluationId: string; versionNumber: number; pinned: boolean; memberCount: number | null; finishedAt: string | null }[];
  contactIds: string[];
  includedTotal: number;
  removedByExclusions: number;
}

/**
 * The audience snapshots in use. Refuses (never substitutes) when a segment
 * has no complete snapshot or the audience isn't CRM contacts — contacts are
 * the only records with recorded consent.
 */
export async function resolveCampaignAudience(companyId: string, campaignId: string, db: Db = prisma): Promise<ResolvedAudience> {
  const rows = await db.marketingCampaignAudience.findMany({ where: { companyId, campaignId }, include: { segment: true, pinnedEvaluation: true }, orderBy: { createdAt: "asc" } });
  if (!rows.some((r) => r.role === "INCLUDE")) throw new BusinessRuleError("VALIDATION_ERROR", "The campaign has no audience. Add at least one include segment on the campaign page.");
  const other = rows.find((r) => r.segment.sourceType !== "CONTACT");
  if (other) throw new BusinessRuleError("VALIDATION_ERROR", `Delivery needs an audience of CRM contacts — consent is only recorded for contacts. ${other.segment.code} is a segment of other records.`);
  const latestIds = rows.filter((r) => !r.pinnedEvaluationId && r.segment.lastEvaluationId).map((r) => r.segment.lastEvaluationId!);
  const latest = new Map((await db.marketingSegmentEvaluation.findMany({ where: { id: { in: latestIds } } })).map((e) => [e.id, e]));
  const segments: ResolvedAudience["segments"] = [];
  for (const r of rows) {
    const ev = r.pinnedEvaluation ?? (r.segment.lastEvaluationId ? latest.get(r.segment.lastEvaluationId) : undefined);
    if (!ev || ev.status !== "COMPLETED" || ev.entriesPurgedAt) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${r.segment.code} has no complete snapshot${r.pinnedEvaluationId ? " (the pinned one is no longer available)" : ""}. Refresh it, or pin a kept snapshot, before sending.`);
    }
    segments.push({ segmentId: r.segmentId, code: r.segment.code, role: r.role, evaluationId: ev.id, versionNumber: ev.versionNumber, pinned: Boolean(r.pinnedEvaluationId), memberCount: ev.memberCount, finishedAt: ev.finishedAt?.toISOString() ?? null });
  }
  const inc = segments.filter((s) => s.role === "INCLUDE").map((s) => s.evaluationId);
  const exc = segments.filter((s) => s.role === "EXCLUDE").map((s) => s.evaluationId);
  const incRows = await db.marketingSegmentSnapshotEntry.findMany({ where: { evaluationId: { in: inc }, outcome: "INCLUDED" }, select: { recordId: true } });
  const excRows = exc.length ? await db.marketingSegmentSnapshotEntry.findMany({ where: { evaluationId: { in: exc }, outcome: "INCLUDED" }, select: { recordId: true } }) : [];
  const excluded = new Set(excRows.map((r) => r.recordId));
  const distinct = [...new Set(incRows.map((r) => r.recordId))];
  const contactIds = distinct.filter((id) => !excluded.has(id)).sort();
  return { segments, contactIds, includedTotal: distinct.length, removedByExclusions: distinct.length - contactIds.length };
}

export interface ContactEligibility {
  contactId: string;
  /** The contact the message goes to (a merged contact's survivor). */
  name: string | null;
  destination: string | null;
  ok: boolean;
  reason: SkipReasonKey | null;
}

/** Where each channel's address comes from on a contact. */
function rawAddress(channel: MarketingChannelKey, c: { email: string | null; mobile: string | null; phone: string | null; whatsapp: string | null }) {
  if (channel === "EMAIL") return c.email;
  if (channel === "SMS") return c.mobile || c.phone;
  return c.whatsapp || c.mobile;
}

/**
 * Checks a batch of contacts right now: still available, an address valid
 * for this provider, and consent on this channel. OPT_OUT: allowed unless
 * an opt-out / DND / bounce is recorded (this channel or "all channels").
 * OPT_IN: also needs a recorded ALLOWED row for the channel or for "all".
 * A missing consent row is never treated as an opt-in.
 */
export async function checkContacts(
  companyId: string,
  contactIds: string[],
  channel: MarketingChannelKey,
  adapter: Pick<MarketingProviderAdapter, "normalizeDestination">,
  config: Record<string, string | number>,
  consentPolicy: ConsentPolicyKey,
  db: Db = prisma
): Promise<ContactEligibility[]> {
  if (!contactIds.length) return [];
  const contacts = await db.crmContact.findMany({
    where: { companyId, id: { in: contactIds } },
    select: { id: true, fullName: true, email: true, mobile: true, phone: true, whatsapp: true, archivedAt: true, mergedIntoId: true, consents: { select: { channel: true, status: true, reason: true } } },
  });
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const consentChannel = MARKETING_CHANNELS[channel].consentChannel;
  return contactIds.map((id) => {
    const c = byId.get(id);
    if (!c || c.archivedAt || c.mergedIntoId) return { contactId: id, name: c?.fullName ?? null, destination: null, ok: false, reason: "RECORD_UNAVAILABLE" as const };
    const raw = rawAddress(channel, c);
    if (!raw || !raw.trim()) return { contactId: id, name: c.fullName, destination: null, ok: false, reason: "NO_ADDRESS" as const };
    const destination = adapter.normalizeDestination(raw, config);
    if (!destination) return { contactId: id, name: c.fullName, destination: null, ok: false, reason: "INVALID_ADDRESS" as const };
    const decision = canContact(c.consents, consentChannel);
    if (!decision.allowed) return { contactId: id, name: c.fullName, destination, ok: false, reason: "CONSENT_RESTRICTED" as const };
    if (consentPolicy === "OPT_IN") {
      const optedIn = c.consents.some((r) => (r.channel === consentChannel || r.channel === "ALL") && r.status === "ALLOWED");
      if (!optedIn) return { contactId: id, name: c.fullName, destination, ok: false, reason: "CONSENT_MISSING" as const };
    }
    return { contactId: id, name: c.fullName, destination, ok: true, reason: null };
  });
}

/** Marks later recipients with an address already used in this list (one message per address). */
export function markDuplicateAddresses(rows: ContactEligibility[], seen = new Set<string>()): ContactEligibility[] {
  return rows.map((r) => {
    if (!r.ok || !r.destination) return r;
    if (seen.has(r.destination)) return { ...r, ok: false, reason: "DUPLICATE_ADDRESS" as const };
    seen.add(r.destination);
    return r;
  });
}

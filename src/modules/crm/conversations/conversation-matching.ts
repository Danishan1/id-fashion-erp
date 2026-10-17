import type { NormalizedIdentity } from "@/core/communication/CommunicationProvider";
import { prisma } from "@/core/db/client";
import { identifierKey, type MatchStatus } from "./conversation-registry";
import { CrmConversationRepository } from "./crm-conversation.repository";

/**
 * Central contact matching for inbound conversations (Phase 11).
 *
 * Only authoritative identifiers are used — no fuzzy name matching:
 *   EMAIL       → a contact's email keys (core emails + extra email channels)
 *   PHONE       → a contact's phone keys (phone, mobile, WhatsApp, extra numbers; last 10 digits)
 *   PROVIDER_ID / SESSION → a contact a user already linked to this identity on this channel
 *
 * The sender's main identity is tried first; other identities it supplied
 * (a chat visitor's email) only when the main one finds nothing. Exactly one
 * contact → MATCHED. Several → MULTIPLE (the user picks; we never guess),
 * except that a single non-archived contact among archived ones wins. None →
 * UNMATCHED (the unmatched queue). Merged contacts resolve to their survivor.
 * No contact is ever created here.
 */
export interface ContactMatch {
  status: MatchStatus;
  contactId: string | null;
  crmCompanyId: string | null;
  candidateIds: string[];
  matchedBy: NormalizedIdentity["kind"] | null;
}

const UNMATCHED: ContactMatch = { status: "UNMATCHED", contactId: null, crmCompanyId: null, candidateIds: [], matchedBy: null };

interface Candidate {
  id: string;
  archivedAt: Date | null;
  mergedIntoId: string | null;
  crmCompanyId: string | null;
}

/** Follows merge chains to the surviving contact. */
async function survivors(companyId: string, rows: Candidate[]): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  for (const row of rows) {
    let current: Candidate | null = row;
    for (let hops = 0; current?.mergedIntoId && hops < 10; hops++) {
      current = await prisma.crmContact.findFirst({ where: { id: current.mergedIntoId, companyId }, select: { id: true, archivedAt: true, mergedIntoId: true, crmCompanyId: true } });
    }
    if (current && !current.mergedIntoId) out.set(current.id, current);
  }
  return [...out.values()];
}

async function candidatesFor(companyId: string, channelId: string, identity: NormalizedIdentity): Promise<Candidate[]> {
  const key = identifierKey(identity.kind, identity.value);
  if (!key) return [];
  const select = { id: true, archivedAt: true, mergedIntoId: true, crmCompanyId: true } as const;
  if (identity.kind === "EMAIL") return prisma.crmContact.findMany({ where: { companyId, mergedIntoId: null, emailKeys: { has: key } }, select, take: 20 });
  if (identity.kind === "PHONE") return prisma.crmContact.findMany({ where: { companyId, mergedIntoId: null, phoneKeys: { has: key } }, select, take: 20 });
  const ids = await CrmConversationRepository.contactsForIdentity(companyId, channelId, identity.kind, key);
  if (!ids.length) return [];
  return survivors(companyId, await prisma.crmContact.findMany({ where: { companyId, id: { in: ids } }, select }));
}

export function decideMatch(candidates: Candidate[], matchedBy: NormalizedIdentity["kind"]): ContactMatch | null {
  if (!candidates.length) return null;
  const active = candidates.filter((c) => !c.archivedAt);
  const pick = candidates.length === 1 ? candidates[0] : active.length === 1 ? active[0] : null;
  if (pick) return { status: "MATCHED", contactId: pick.id, crmCompanyId: pick.crmCompanyId, candidateIds: [], matchedBy };
  return { status: "MULTIPLE", contactId: null, crmCompanyId: null, candidateIds: candidates.map((c) => c.id).slice(0, 10), matchedBy };
}

export async function matchContact(companyId: string, channelId: string, primary: NormalizedIdentity, alternates: NormalizedIdentity[] = []): Promise<ContactMatch> {
  for (const identity of [primary, ...alternates]) {
    const decided = decideMatch(await candidatesFor(companyId, channelId, identity), identity.kind);
    if (decided) return decided;
  }
  return UNMATCHED;
}

/** Exactly one open opportunity for the contact → it is the obvious one to link; otherwise the user chooses. */
export async function soleOpenOpportunity(companyId: string, contactId: string): Promise<string | null> {
  const rows = await prisma.crmOpportunity.findMany({ where: { companyId, crmContactId: contactId, status: "OPEN", archivedAt: null }, select: { id: true }, take: 2 });
  return rows.length === 1 ? rows[0].id : null;
}

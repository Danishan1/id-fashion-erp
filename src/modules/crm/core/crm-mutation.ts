import type { AuditAction, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import type { CrmActor } from "./crm-actor";
import { dispatchCrmEvents } from "./crm-event-bus";
import { CrmEventRepository, type CrmEventRow } from "./crm-event.repository";
import type { CrmEventInput } from "./crm-event.schema";
import { buildCrmEventData } from "./crm-events.service";

export interface CrmAuditInput {
  tableName: string;
  recordId: string;
  action: AuditAction;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

export interface CrmMutationContext {
  /** Use for every write in this mutation so they commit or roll back together. */
  tx: Prisma.TransactionClient;
  /** Queue a business event; written inside the same transaction. */
  emit(event: CrmEventInput): void;
  /** Write the ERP AuditLog row inside the same transaction. */
  audit(entry: CrmAuditInput): Promise<void>;
}

/**
 * Records that keep a "last activity" timestamp get it bumped by every event
 * written about them, in the same transaction — whichever service emitted
 * the event (notes, tags, merge…). Contacts since Phase 04, companies since Phase 05.
 */
async function touchLastActivity(tx: Prisma.TransactionClient, rows: CrmEventRow[]) {
  const contactIds = [...new Set(rows.filter((r) => r.entityType === "CONTACT").map((r) => r.entityId))];
  const companyIds = [...new Set(rows.filter((r) => r.entityType === "COMPANY").map((r) => r.entityId))];
  const opportunityIds = [...new Set(rows.filter((r) => r.entityType === "OPPORTUNITY").map((r) => r.entityId))];
  if (!contactIds.length && !companyIds.length && !opportunityIds.length) return;
  const at = rows.reduce<Date>((max, r) => (r.occurredAt && r.occurredAt > max ? r.occurredAt : max), new Date(0));
  const when = at.getTime() ? at : new Date();
  const stale = { OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: when } }] };
  if (contactIds.length) await tx.crmContact.updateMany({ where: { id: { in: contactIds }, ...stale }, data: { lastActivityAt: when } });
  if (companyIds.length) await tx.crmCompany.updateMany({ where: { id: { in: companyIds }, ...stale }, data: { lastActivityAt: when } });
  if (opportunityIds.length) await tx.crmOpportunity.updateMany({ where: { id: { in: opportunityIds }, ...stale }, data: { lastActivityAt: when } });
}

/**
 * The one way a CRM service changes data. Runs `fn` in a single database
 * transaction, then writes every emitted CRM event in that same transaction,
 * so the record, its AuditLog row and its timeline events either all exist
 * or none do. After commit, events are handed to in-process subscribers.
 *
 *   return runCrmMutation(actor, async ({ tx, emit, audit }) => {
 *     const lead = await LeadRepository.create(tx, data);
 *     await audit({ tableName: "crm_leads", recordId: lead.id, action: "CREATE", newValues: lead });
 *     emit({ entityType: "LEAD", entityId: lead.id, eventType: "lead.created", summary: lead.name });
 *     return lead;
 *   });
 *
 * Event input is validated before anything is written: an unknown event type
 * aborts the whole mutation instead of saving a record with a broken history.
 */
export async function runCrmMutation<T>(actor: CrmActor, fn: (ctx: CrmMutationContext) => Promise<T>): Promise<T> {
  const { result, written } = await prisma.$transaction(async (tx) => {
    const pending: Prisma.CrmEventUncheckedCreateInput[] = [];
    const ctx: CrmMutationContext = {
      tx,
      emit: (event) => {
        pending.push(buildCrmEventData(actor, event));
      },
      audit: async (entry) => {
        await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, ...entry }, tx);
      },
    };
    const value = await fn(ctx);
    const rows: CrmEventRow[] = [];
    for (const data of pending) rows.push(await CrmEventRepository.create(data, tx));
    await touchLastActivity(tx, rows);
    return { result: value, written: rows };
  });
  await dispatchCrmEvents(written);
  return result;
}

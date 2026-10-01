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
    return { result: value, written: rows };
  });
  await dispatchCrmEvents(written);
  return result;
}

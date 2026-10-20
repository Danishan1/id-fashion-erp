import type { CrmEntityType, Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { listCustomFields } from "../custom-fields/crm-custom-fields.service";
import type { CrmCustomFieldType } from "@prisma/client";
import { CUSTOM_FIELD_ENTITIES, isWorkflowEntity, type WorkflowEntity, type WorkflowFieldDef } from "./workflow-fields";
import { WORKFLOW_CORRELATION_PREFIX } from "./workflow-registry";

/**
 * Builds the flat snapshot conditions are evaluated against:
 *   record.*   — the record, read fresh from the database at evaluation time
 *   trigger.*  — the triggering event's payload (frozen in the execution)
 *   event.*    — who made the change, and whether a workflow did
 *   custom.*   — the record's custom field values
 * One query per record type; only the whitelisted fields (workflow-fields.ts).
 * Reads are company-scoped and deliberately NOT visibility-scoped: conditions
 * decide routing, they never expose data (actions re-check visibility as the
 * run-as user through the CRM services).
 */

export interface TriggerFacts {
  eventId?: string | null;
  eventType?: string | null;
  payload?: Record<string, unknown> | null;
  actorUserId?: string | null;
  correlationId?: string | null;
  occurredAt?: string | null;
}

export interface RecordSnapshot {
  exists: boolean;
  values: Record<string, unknown>;
  /** Owner / assignee (for "record owner" recipients). */
  ownerUserId: string | null;
  /** Records related to it, for templates / tasks (Phase 12 refs). */
  refs: { contactId?: string; companyId?: string; opportunityId?: string; leadId?: string; conversationId?: string; appointmentId?: string };
  /** A short label for traces ("LEAD-2026-00012 · Rahul Sharma"). */
  label: string;
  /** Record version (optimistic locking) for actions that need it. */
  version: number | null;
  /** For activities: the record the task / appointment is on. */
  parent?: { entityType: CrmEntityType; entityId: string } | null;
}

const MISSING: RecordSnapshot = { exists: false, values: {}, ownerUserId: null, refs: {}, label: "Deleted record", version: null };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

async function tagIds(companyId: string, entityType: CrmEntityType, entityId: string): Promise<string[]> {
  const rows = await prisma.crmEntityTag.findMany({ where: { companyId, entityType, entityId }, select: { tagId: true } });
  return rows.map((r) => r.tagId);
}

function customValues(json: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (json && typeof json === "object" && !Array.isArray(json)) for (const [k, v] of Object.entries(json as Record<string, unknown>)) out[`custom.${k}`] = v;
  return out;
}

export async function loadRecordSnapshot(companyId: string, entityType: CrmEntityType, entityId: string): Promise<RecordSnapshot> {
  switch (entityType) {
    case "LEAD": {
      const l = await prisma.crmLead.findFirst({ where: { id: entityId, companyId }, include: { status: { select: { kind: true } } } });
      if (!l) return MISSING;
      return {
        exists: true,
        ownerUserId: l.ownerUserId,
        version: l.version,
        label: `${l.leadNumber} · ${l.fullName}`,
        refs: { leadId: l.id, ...(l.crmContactId ? { contactId: l.crmContactId } : {}), ...(l.crmCompanyId ? { companyId: l.crmCompanyId } : {}) },
        values: {
          "record.full_name": l.fullName,
          "record.company_name": l.companyName,
          "record.email": l.email,
          "record.phone": l.mobile ?? l.phone ?? l.whatsapp,
          "record.status": l.statusId,
          "record.status_kind": l.status?.kind ?? null,
          "record.source": l.sourceId,
          "record.owner": l.ownerUserId,
          "record.score": l.score,
          "record.temperature": l.temperature,
          "record.estimated_value": num(l.estimatedValue),
          "record.capture_channel": l.captureChannel,
          "record.industry": l.industry,
          "record.city": l.city,
          "record.state": l.state,
          "record.country": l.country,
          "record.utm_source": l.utmSource,
          "record.utm_campaign": l.utmCampaign,
          "record.next_follow_up_at": iso(l.nextFollowUpAt),
          "record.last_contacted_at": iso(l.lastContactedAt),
          "record.is_converted": Boolean(l.convertedAt),
          "record.is_archived": Boolean(l.archivedAt),
          "record.tags": await tagIds(companyId, "LEAD", l.id),
          "record.created_at": iso(l.createdAt),
          "record.updated_at": iso(l.updatedAt),
          ...customValues(l.customFields),
        },
      };
    }
    case "CONTACT": {
      const c = await prisma.crmContact.findFirst({ where: { id: entityId, companyId } });
      if (!c) return MISSING;
      if (c.mergedIntoId) return { ...MISSING, label: "Merged contact" };
      return {
        exists: true,
        ownerUserId: c.ownerUserId,
        version: c.version,
        label: c.fullName,
        refs: { contactId: c.id, ...(c.crmCompanyId ? { companyId: c.crmCompanyId } : {}) },
        values: {
          "record.full_name": c.fullName,
          "record.email": c.email,
          "record.phone": c.mobile ?? c.phone ?? c.whatsapp,
          "record.designation": c.designation,
          "record.department": c.department,
          "record.owner": c.ownerUserId,
          "record.has_company": Boolean(c.crmCompanyId),
          "record.last_activity_at": iso(c.lastActivityAt),
          "record.is_archived": Boolean(c.archivedAt),
          "record.tags": await tagIds(companyId, "CONTACT", c.id),
          "record.created_at": iso(c.createdAt),
          "record.updated_at": iso(c.updatedAt),
          ...customValues(c.customFields),
        },
      };
    }
    case "COMPANY": {
      const c = await prisma.crmCompany.findFirst({ where: { id: entityId, companyId } });
      if (!c) return MISSING;
      if (c.mergedIntoId) return { ...MISSING, label: "Merged company" };
      return {
        exists: true,
        ownerUserId: c.ownerUserId,
        version: c.version,
        label: c.name,
        refs: { companyId: c.id, ...(c.primaryContactId ? { contactId: c.primaryContactId } : {}) },
        values: {
          "record.name": c.name,
          "record.status": c.statusId,
          "record.owner": c.ownerUserId,
          "record.company_type": c.companyType,
          "record.industry": c.industry,
          "record.city": c.city,
          "record.state": c.state,
          "record.country": c.country,
          "record.email": c.email,
          "record.website": c.website,
          "record.is_erp_customer": Boolean(c.customerId),
          "record.last_activity_at": iso(c.lastActivityAt),
          "record.is_archived": Boolean(c.archivedAt),
          "record.tags": await tagIds(companyId, "COMPANY", c.id),
          "record.created_at": iso(c.createdAt),
          "record.updated_at": iso(c.updatedAt),
          ...customValues(c.customFields),
        },
      };
    }
    case "OPPORTUNITY": {
      const o = await prisma.crmOpportunity.findFirst({ where: { id: entityId, companyId } });
      if (!o) return MISSING;
      return {
        exists: true,
        ownerUserId: o.ownerUserId,
        version: o.version,
        label: `${o.opportunityNumber} · ${o.name}`,
        refs: { opportunityId: o.id, ...(o.crmContactId ? { contactId: o.crmContactId } : {}), ...(o.crmCompanyId ? { companyId: o.crmCompanyId } : {}), ...(o.leadId ? { leadId: o.leadId } : {}) },
        values: {
          "record.name": o.name,
          "record.status": o.status,
          "record.pipeline": o.pipelineId,
          "record.stage": o.stageId,
          "record.owner": o.ownerUserId,
          "record.amount": num(o.amount),
          "record.currency": o.currencyCode,
          "record.probability": o.probability,
          "record.expected_close_date": iso(o.expectedCloseDate),
          "record.stage_changed_at": iso(o.stageChangedAt),
          "record.has_company": Boolean(o.crmCompanyId),
          "record.has_contact": Boolean(o.crmContactId),
          "record.last_activity_at": iso(o.lastActivityAt),
          "record.is_archived": Boolean(o.archivedAt),
          "record.tags": await tagIds(companyId, "OPPORTUNITY", o.id),
          "record.created_at": iso(o.createdAt),
          "record.updated_at": iso(o.updatedAt),
          ...customValues(o.customFields),
        },
      };
    }
    case "ACTIVITY": {
      const a = await prisma.crmActivity.findFirst({ where: { id: entityId, companyId } });
      if (!a || a.deletedAt) return MISSING;
      const refs: RecordSnapshot["refs"] = a.type === "APPOINTMENT" ? { appointmentId: a.id } : {};
      if (a.entityType === "CONTACT") refs.contactId = a.entityId;
      if (a.entityType === "COMPANY") refs.companyId = a.entityId;
      if (a.entityType === "OPPORTUNITY") refs.opportunityId = a.entityId;
      if (a.entityType === "LEAD") refs.leadId = a.entityId;
      return {
        exists: true,
        ownerUserId: a.assignedToUserId,
        version: a.version,
        label: a.subject,
        refs,
        parent: { entityType: a.entityType, entityId: a.entityId },
        values: {
          "record.type": a.type,
          "record.subject": a.subject,
          "record.status": a.status,
          "record.priority": a.priority,
          "record.assigned_to": a.assignedToUserId,
          "record.due_at": iso(a.dueAt),
          "record.outcome": a.outcome,
          "record.record_type": a.entityType,
          "record.created_at": iso(a.createdAt),
          "record.updated_at": iso(a.updatedAt),
        },
      };
    }
    case "CONVERSATION": {
      const c = await prisma.crmConversation.findFirst({ where: { id: entityId, companyId } });
      if (!c) return MISSING;
      return {
        exists: true,
        ownerUserId: c.assignedToUserId,
        version: c.version,
        label: c.displayName ?? c.displayIdentifier ?? "Conversation",
        refs: { conversationId: c.id, ...(c.contactId ? { contactId: c.contactId } : {}), ...(c.crmCompanyId ? { companyId: c.crmCompanyId } : {}), ...(c.opportunityId ? { opportunityId: c.opportunityId } : {}) },
        values: {
          "record.status": c.status,
          "record.channel_type": c.channelType,
          "record.assigned_to": c.assignedToUserId,
          "record.has_contact": Boolean(c.contactId),
          "record.unread_count": c.unreadCount,
          "record.last_inbound_at": iso(c.lastInboundAt),
          "record.last_outbound_at": iso(c.lastOutboundAt),
          "record.created_at": iso(c.createdAt),
          "record.updated_at": iso(c.updatedAt),
        },
      };
    }
    default:
      return MISSING;
  }
}

/** Full condition snapshot: record + trigger payload + event facts. */
export function buildConditionSnapshot(record: RecordSnapshot, trigger: TriggerFacts | null, execution: { startedAt?: string | null } = {}): Record<string, unknown> {
  const values: Record<string, unknown> = { ...record.values };
  const payload = trigger?.payload ?? {};
  for (const [k, v] of Object.entries(payload)) if (v === null || ["string", "number", "boolean"].includes(typeof v)) values[`trigger.${k}`] = v;
  values["event.actor"] = trigger?.actorUserId ?? null;
  values["event.by_workflow"] = Boolean(trigger?.correlationId?.startsWith(WORKFLOW_CORRELATION_PREFIX));
  values["execution.started_at"] = execution.startedAt ?? null;
  return values;
}

const CUSTOM_TYPE: Record<CrmCustomFieldType, WorkflowFieldDef["type"]> = {
  TEXT: "string",
  TEXTAREA: "string",
  PHONE: "string",
  EMAIL: "string",
  URL: "string",
  NUMBER: "number",
  DECIMAL: "number",
  CURRENCY: "number",
  DATE: "date",
  DATETIME: "date",
  BOOLEAN: "boolean",
  DROPDOWN: "enum",
  MULTI_SELECT: "tags",
};

/** Custom fields of a record type as condition fields (`custom.<key>`). */
export async function customFieldDefs(companyId: string, entity: WorkflowEntity | null): Promise<WorkflowFieldDef[]> {
  if (!entity || !isWorkflowEntity(entity) || !CUSTOM_FIELD_ENTITIES.includes(entity)) return [];
  const defs = await listCustomFields(companyId, entity, { includeInactive: true });
  return defs.map((d) => ({ key: `custom.${d.key}`, label: `${d.label} (custom)`, type: CUSTOM_TYPE[d.fieldType], ...(d.options ? { options: d.options } : {}) }));
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import type { CrmLeadPriority, LeadQuality, Prisma } from "@prisma/client";
import { CrmRoundRobinRepository, LeadRepository } from "./lead.repository";
import { DEFAULT_LEAD_PRIORITY_THRESHOLDS, getCrmSettings, type LeadPriorityThresholds } from "./crm-settings.service";
import { ensureCrmDefaults, getEntryStage, getStageForCompany } from "./crm-config.service";
import { FALLBACK_SOURCE_CODE } from "./crm-defaults";
import { buildLeadSegmentWhere, createdRangeWhere, isLeadSegment } from "./lead-segments";
import type { ChangeLeadStageInput, CreateLeadInput, UpdateLeadInput } from "./lead.schema";
import { CRM_LEAD_PRIORITIES } from "./lead.schema";

export interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

/** Deliberately NOT a stored column — see the Prisma schema's own comment on
 * LeadQuality. Thresholds are a per-company setting (`CrmSettings`), computed
 * fresh from leadScore every time so it can never drift. */
export function computeLeadQuality(
  leadScore: number | string | Prisma.Decimal,
  thresholds: LeadPriorityThresholds = DEFAULT_LEAD_PRIORITY_THRESHOLDS
): LeadQuality {
  const score = Number(leadScore);
  if (score >= thresholds.hotThreshold) return "HOT";
  if (score >= thresholds.warmThreshold) return "WARM";
  return "COLD";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds the derived read-time fields every lead response carries. */
function decorateLead<T extends { leadScore: Prisma.Decimal | number | string; createdAt: Date; stageChangedAt: Date; lastActivityAt: Date | null }>(
  lead: T,
  thresholds: LeadPriorityThresholds,
  now = Date.now()
) {
  const daysSince = (d: Date) => Math.max(0, Math.floor((now - d.getTime()) / DAY_MS));
  return {
    ...lead,
    quality: computeLeadQuality(lead.leadScore, thresholds),
    daysSinceCreated: daysSince(lead.createdAt),
    daysInCurrentStage: daysSince(lead.stageChangedAt),
    daysSinceLastActivity: lead.lastActivityAt ? daysSince(lead.lastActivityAt) : null,
  };
}

function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export type DuplicateCheckInput = Pick<CreateLeadInput, "email" | "phone" | "whatsappNumber" | "alternativePhone" | "companyName" | "country">;

/** The one duplicate definition — used by the save-time guard below and by
 * the live "possible duplicate" panel on the Add Lead form (so the warning
 * the user sees while typing is exactly what saving would reject). */
export async function findPossibleDuplicates(companyId: string, input: DuplicateCheckInput, excludeId?: string) {
  const phones = [input.phone, input.whatsappNumber, input.alternativePhone].map(normalizePhone).filter((p): p is string => !!p);
  return LeadRepository.findDuplicates(
    companyId,
    {
      email: input.email?.trim() || null,
      phones: [...new Set(phones)],
      companyName: input.companyName?.trim() || null,
      country: input.country?.trim() || null,
    },
    excludeId
  );
}

async function assertNoDuplicate(companyId: string, input: DuplicateCheckInput & { overrideDuplicateCheck?: boolean }, excludeId?: string) {
  if (input.overrideDuplicateCheck) return;
  const dups = await findPossibleDuplicates(companyId, input, excludeId);
  if (dups.length > 0) {
    throw new BusinessRuleError(
      "DUPLICATE_LEAD_EXISTS",
      `A possible duplicate lead already exists: ${dups.map((d) => `${d.companyName ?? d.name} (${d.leadNumber})`).join(", ")}.`,
      { duplicates: dups }
    );
  }
}

/** A manual, low-frequency action (creating a lead) — a real stored pointer
 * advanced here is enough; the atomic-guarded-updateMany idiom used for hot
 * concurrent paths elsewhere in this project would be overkill here. */
async function getNextRoundRobinAssignee(companyId: string): Promise<string | null> {
  const users = await prisma.user.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (users.length === 0) return null;

  const state = await CrmRoundRobinRepository.findOrCreate(companyId);
  const ids = users.map((u) => u.id);
  const lastIndex = state.lastAssignedUserId ? ids.indexOf(state.lastAssignedUserId) : -1;
  const next = ids[(lastIndex + 1) % ids.length];
  await CrmRoundRobinRepository.updateLastAssigned(companyId, next);
  return next;
}

/** Every master FK a lead carries must belong to the actor's own company —
 * a client-supplied id is never trusted (same chokepoint discipline as
 * branch/role ids in user-admin). Returns the resolved source id. */
async function resolveLeadRefs(companyId: string, input: CreateLeadInput): Promise<{ sourceId: string | null }> {
  const checks: Array<Promise<void>> = [];
  const mustExist = (label: string, found: Promise<unknown>) =>
    checks.push(
      found.then((row) => {
        if (!row) throw new BusinessRuleError("NOT_FOUND", `${label} not found.`);
      })
    );

  if (input.productCategoryId) mustExist("Product category", prisma.category.findFirst({ where: { id: input.productCategoryId, companyId }, select: { id: true } }));
  if (input.seasonId) mustExist("Season", prisma.season.findFirst({ where: { id: input.seasonId, companyId }, select: { id: true } }));
  if (input.campaignId) mustExist("Campaign", prisma.campaign.findFirst({ where: { id: input.campaignId, companyId }, select: { id: true } }));
  if (input.assignedToUserId) mustExist("Assigned user", prisma.user.findFirst({ where: { id: input.assignedToUserId, companyId }, select: { id: true } }));
  const typeIds = [...new Set(input.productInterestTypeIds ?? [])];
  if (typeIds.length > 0) {
    checks.push(
      prisma.productType.count({ where: { id: { in: typeIds }, companyId } }).then((n) => {
        if (n !== typeIds.length) throw new BusinessRuleError("NOT_FOUND", "One or more product interest types were not found.");
      })
    );
  }
  await Promise.all(checks);

  if (input.sourceId) {
    const source = await prisma.crmLeadSource.findFirst({ where: { id: input.sourceId, companyId }, select: { id: true } });
    if (!source) throw new BusinessRuleError("NOT_FOUND", "Lead source not found.");
    return { sourceId: source.id };
  }
  await ensureCrmDefaults(companyId);
  const fallback = await prisma.crmLeadSource.findFirst({ where: { companyId, code: FALLBACK_SOURCE_CODE }, select: { id: true } });
  return { sourceId: fallback?.id ?? null };
}

/** Field mapping shared by create and update (everything except identity,
 * stage, assignment and ownership columns). */
function leadDataFromInput(input: CreateLeadInput, sourceId: string | null) {
  return {
    name: input.name,
    companyName: input.companyName || null,
    designation: input.designation || null,
    email: input.email || null,
    phone: input.phone || null,
    whatsappNumber: input.whatsappNumber || null,
    alternativePhone: input.alternativePhone || null,
    website: input.website || null,
    businessType: input.businessType || null,
    country: input.country || null,
    state: input.state || null,
    city: input.city || null,
    address: input.address || null,
    productCategoryId: input.productCategoryId || null,
    seasonId: input.seasonId || null,
    market: input.market || null,
    expectedQuantity: input.expectedQuantity ?? null,
    targetPrice: input.targetPrice ?? null,
    currencyCode: input.currencyCode ? input.currencyCode.toUpperCase() : null,
    moqRequirement: input.moqRequirement || null,
    requiredDeliveryDate: input.requiredDeliveryDate ? new Date(input.requiredDeliveryDate) : null,
    samplingRequired: input.samplingRequired ?? false,
    techPackAvailable: input.techPackAvailable ?? false,
    referenceImageAvailable: input.referenceImageAvailable ?? false,
    sourceId,
    campaignId: input.campaignId || null,
    campaignText: input.campaignText || null,
    leadScore: input.leadScore,
    value: input.value,
    expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
    notes: input.notes || null,
  };
}

export interface LeadListFilters {
  stageId?: string;
  sourceId?: string;
  priority?: string;
  assignedToUserId?: string;
  country?: string;
  /** A named segment from lead-segments.ts — the same definition the CRM
   * dashboard counts with, so a card's number matches this list exactly. */
  segment?: string;
  createdFrom?: string;
  createdTo?: string;
}

const VALID_PRIORITIES = new Set<string>(CRM_LEAD_PRIORITIES);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listLeads(companyId: string, query: ListQuery, filters: LeadListFilters = {}) {
  // The generic DataTable status filter arrives as query.status — for leads
  // that is a pipeline stage id.
  const stageId = filters.stageId ?? query.status;
  const where: Prisma.LeadWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { leadNumber: { contains: query.search, mode: "insensitive" as const } },
            { name: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { phone: { contains: query.search, mode: "insensitive" as const } },
            { whatsappNumber: { contains: query.search, mode: "insensitive" as const } },
            { companyName: { contains: query.search, mode: "insensitive" as const } },
            { country: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(stageId && UUID_RE.test(stageId) ? { stageId } : {}),
    ...(filters.sourceId && UUID_RE.test(filters.sourceId) ? { sourceId: filters.sourceId } : {}),
    ...(filters.assignedToUserId && UUID_RE.test(filters.assignedToUserId) ? { assignedToUserId: filters.assignedToUserId } : {}),
    ...(filters.priority && VALID_PRIORITIES.has(filters.priority) ? { priority: filters.priority as CrmLeadPriority } : {}),
    ...(filters.country ? { country: { equals: filters.country, mode: "insensitive" as const } } : {}),
    ...createdRangeWhere(filters.createdFrom, filters.createdTo),
  };
  if (isLeadSegment(filters.segment)) {
    where.AND = [await buildLeadSegmentWhere(companyId, filters.segment)];
  }

  const [data, totalCount, thresholds] = await Promise.all([
    LeadRepository.findMany(where, { orderBy: { [query.sortBy]: query.sortOrder }, skip: query.skip, take: query.take }),
    LeadRepository.count(where),
    getCrmSettings(companyId),
  ]);

  const now = Date.now();
  return { data: data.map((l) => decorateLead(l, thresholds, now)), totalCount };
}

export async function getLeadById(companyId: string, id: string) {
  const [lead, thresholds] = await Promise.all([LeadRepository.findByIdWithDetails(companyId, id), getCrmSettings(companyId)]);
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });
  return decorateLead(lead, thresholds);
}

export async function createLead(actor: ActorContext, input: CreateLeadInput) {
  await assertNoDuplicate(actor.companyId, input);
  const { sourceId } = await resolveLeadRefs(actor.companyId, input);
  const entryStage = await getEntryStage(actor.companyId);

  const leadNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "LEAD",
  });

  const assignedToUserId = input.assignedToUserId || (await getNextRoundRobinAssignee(actor.companyId));
  const now = new Date();
  const typeIds = [...new Set(input.productInterestTypeIds ?? [])];

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        companyId: actor.companyId,
        branchId: actor.branchId || null,
        leadNumber,
        ...leadDataFromInput(input, sourceId),
        priority: input.priority ?? "MEDIUM",
        stageId: entryStage.id,
        stageChangedAt: now,
        assignedToUserId,
        assignedAt: assignedToUserId ? now : null,
        createdByUserId: actor.userId,
        ...(typeIds.length > 0 ? { productInterests: { createMany: { data: typeIds.map((productTypeId) => ({ productTypeId })) } } } : {}),
      },
    });

    await tx.crmStageHistory.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "LEAD",
        relatedRecordId: created.id,
        fromStageId: null,
        toStageId: entryStage.id,
        comment: "Lead created",
        changedByUserId: actor.userId,
        changedAt: now,
      },
    });

    if (assignedToUserId) {
      await tx.crmAssignmentHistory.create({
        data: {
          companyId: actor.companyId,
          relatedModule: "LEAD",
          relatedRecordId: created.id,
          fromUserId: null,
          toUserId: assignedToUserId,
          assignedByUserId: actor.userId,
          reason: input.assignedToUserId ? "Assigned at creation" : "Auto-assigned (round robin)",
          assignedAt: now,
        },
      });
    }

    // Auto follow-up on a brand-new lead ("new lead gets one 24h call
    // reminder"), only ever meaningful at create time.
    await tx.crmFollowup.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "LEAD",
        relatedRecordId: created.id,
        assignedToUserId,
        followupDate: new Date(now.getTime() + DAY_MS),
        type: "CALL",
        status: "PENDING",
        notes: "Auto-created — first follow-up on a new lead.",
        createdByUserId: actor.userId,
      },
    });

    return created;
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: lead.id,
    action: "CREATE",
    newValues: { leadNumber, name: input.name, companyName: input.companyName, sourceId, stageId: entryStage.id, assignedToUserId },
  });

  return getLeadById(actor.companyId, lead.id);
}

export async function updateLead(actor: ActorContext, id: string, input: UpdateLeadInput) {
  const existing = await LeadRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  await assertNoDuplicate(actor.companyId, input, id);
  const { sourceId } = await resolveLeadRefs(actor.companyId, { ...input, sourceId: input.sourceId || existing.sourceId || "" });

  // Field omitted entirely (undefined) means "leave assignment as-is," not
  // "unassign" — an explicit empty string still means "unassign."
  const assignedToUserId = input.assignedToUserId !== undefined ? input.assignedToUserId || null : existing.assignedToUserId;
  const assignmentChanged = assignedToUserId !== existing.assignedToUserId;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        ...leadDataFromInput(input, sourceId),
        priority: input.priority ?? existing.priority,
        assignedToUserId,
        ...(assignmentChanged ? { assignedAt: assignedToUserId ? now : null } : {}),
      },
    });

    if (input.productInterestTypeIds !== undefined) {
      await tx.crmLeadProductInterest.deleteMany({ where: { leadId: id } });
      const typeIds = [...new Set(input.productInterestTypeIds)];
      if (typeIds.length > 0) {
        await tx.crmLeadProductInterest.createMany({ data: typeIds.map((productTypeId) => ({ leadId: id, productTypeId })) });
      }
    }

    if (assignmentChanged) {
      await tx.crmAssignmentHistory.create({
        data: {
          companyId: actor.companyId,
          relatedModule: "LEAD",
          relatedRecordId: id,
          fromUserId: existing.assignedToUserId,
          toUserId: assignedToUserId,
          assignedByUserId: actor.userId,
          reason: "Reassigned",
          assignedAt: now,
        },
      });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: id,
    action: "UPDATE",
    oldValues: { assignedToUserId: existing.assignedToUserId, value: existing.value, priority: existing.priority, sourceId: existing.sourceId },
    newValues: { assignedToUserId, value: input.value, priority: input.priority ?? existing.priority, sourceId },
  });

  return getLeadById(actor.companyId, id);
}

/**
 * The single path every lead stage move goes through (form, Kanban drag,
 * Mark Won/Lost). Rules key on the target stage's `kind`, never its name:
 * - LOST requires a lost reason (company's own master); competitor/comment/
 *   "worth revisiting" and an optional next follow-up are captured with it.
 * - Leaving LOST clears the lost snapshot on the lead (the history row keeps
 *   the full record — nothing is ever silently erased from the audit trail).
 * Every move writes an append-only CrmStageHistory row plus a timeline note.
 */
export async function changeLeadStage(actor: ActorContext, id: string, input: ChangeLeadStageInput) {
  const existing = await LeadRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  const target = await getStageForCompany(actor.companyId, input.stageId);
  if (target.pipeline !== "LEAD") throw new BusinessRuleError("VALIDATION_ERROR", "That stage does not belong to the lead pipeline.");
  if (!target.isActive) throw new BusinessRuleError("VALIDATION_ERROR", `Stage "${target.name}" is inactive.`);
  if (target.id === existing.stageId) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Lead is already in "${target.name}".`);

  const fromStage = await getStageForCompany(actor.companyId, existing.stageId);

  let lostReasonName: string | null = null;
  if (target.kind === "LOST") {
    if (!input.lostReasonId) throw new BusinessRuleError("VALIDATION_ERROR", "A lost reason is required to mark a lead as lost.");
    const reason = await prisma.crmLostReason.findFirst({ where: { id: input.lostReasonId, companyId: actor.companyId } });
    if (!reason) throw new BusinessRuleError("NOT_FOUND", "Lost reason not found.");
    lostReasonName = reason.name;
  }

  const nextFollowupAt = input.nextFollowupAt ? new Date(input.nextFollowupAt) : null;
  if (nextFollowupAt && Number.isNaN(nextFollowupAt.getTime())) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Next follow-up date is invalid.");
  }

  const now = new Date();
  const historyComment = [
    input.comment?.trim() || null,
    lostReasonName ? `Lost reason: ${lostReasonName}` : null,
    target.kind === "LOST" && input.lostCompetitor ? `Competitor: ${input.lostCompetitor}` : null,
    target.kind === "LOST" && input.lostComment ? input.lostComment : null,
  ]
    .filter(Boolean)
    .join(" · ");

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id },
      data: {
        stageId: target.id,
        stageChangedAt: now,
        lastActivityAt: now,
        ...(target.kind === "WON" ? { wonAt: now } : {}),
        ...(target.kind === "LOST"
          ? {
              lostAt: now,
              lostReasonId: input.lostReasonId || null,
              lostCompetitor: input.lostCompetitor || null,
              lostComment: input.lostComment || null,
              lostCanRevisit: input.lostCanRevisit ?? null,
            }
          : { lostAt: null, lostReasonId: null, lostCompetitor: null, lostComment: null, lostCanRevisit: null }),
      },
    });

    await tx.crmStageHistory.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "LEAD",
        relatedRecordId: id,
        fromStageId: fromStage.id,
        toStageId: target.id,
        comment: historyComment || null,
        changedByUserId: actor.userId,
        changedAt: now,
      },
    });

    await tx.crmActivity.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "LEAD",
        relatedRecordId: id,
        activityType: "NOTE",
        subject: `Stage changed: ${fromStage.name} → ${target.name}`,
        body: historyComment || null,
        activityAt: now,
        performedByUserId: actor.userId,
      },
    });

    if (nextFollowupAt) {
      await tx.crmFollowup.create({
        data: {
          companyId: actor.companyId,
          relatedModule: "LEAD",
          relatedRecordId: id,
          assignedToUserId: existing.assignedToUserId,
          followupDate: nextFollowupAt,
          type: "CALL",
          status: "PENDING",
          notes: target.kind === "LOST" ? "Revisit a lost lead" : `Follow-up after moving to ${target.name}`,
          createdByUserId: actor.userId,
        },
      });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: id,
    action: "UPDATE",
    oldValues: { stageId: fromStage.id, stage: fromStage.name },
    newValues: { stageId: target.id, stage: target.name, lostReasonId: input.lostReasonId || null },
  });

  return getLeadById(actor.companyId, id);
}

/** Stage + assignment history for a lead's detail page, newest first. */
export async function getLeadHistory(companyId: string, id: string) {
  const lead = await LeadRepository.findAnyById(companyId, id);
  if (!lead) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  const [stageHistory, assignmentHistory] = await Promise.all([
    prisma.crmStageHistory.findMany({
      where: { companyId, relatedModule: "LEAD", relatedRecordId: id },
      orderBy: { changedAt: "desc" },
      include: {
        fromStage: { select: { id: true, name: true } },
        toStage: { select: { id: true, name: true, kind: true } },
        changedBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.crmAssignmentHistory.findMany({
      where: { companyId, relatedModule: "LEAD", relatedRecordId: id },
      orderBy: { assignedAt: "desc" },
      include: {
        fromUser: { select: { id: true, fullName: true } },
        toUser: { select: { id: true, fullName: true } },
        assignedBy: { select: { id: true, fullName: true } },
      },
    }),
  ]);
  return { stageHistory, assignmentHistory };
}

const MERGE_FILLABLE_FIELDS = [
  "companyName",
  "designation",
  "email",
  "phone",
  "whatsappNumber",
  "alternativePhone",
  "website",
  "businessType",
  "country",
  "state",
  "city",
  "address",
  "productCategoryId",
  "seasonId",
  "market",
  "expectedQuantity",
  "targetPrice",
  "currencyCode",
  "moqRequirement",
  "requiredDeliveryDate",
] as const;

/**
 * "Merge" from the duplicate panel: a new enquiry is folded into an existing
 * lead instead of creating a second record. Strictly non-destructive — it only
 * fills fields the existing lead has left blank, adds any new product
 * interests, appends the new notes, and logs a timeline note recording exactly
 * what was merged. Nothing already on the existing lead is ever overwritten.
 */
export async function mergeEnquiryIntoLead(actor: ActorContext, id: string, input: CreateLeadInput) {
  const existing = await prisma.lead.findFirst({ where: { id, companyId: actor.companyId }, include: { productInterests: true } });
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Lead not found.", { id });

  // Validate every incoming master FK belongs to this company (the blank
  // source fallback is irrelevant here — source is never overwritten).
  await resolveLeadRefs(actor.companyId, { ...input, sourceId: input.sourceId || "" });
  const incoming = leadDataFromInput(input, null);

  const patch: Prisma.LeadUncheckedUpdateInput = {};
  const filled: string[] = [];
  for (const key of MERGE_FILLABLE_FIELDS) {
    const current = existing[key];
    const next = incoming[key];
    if ((current === null || current === "") && next !== null && next !== "") {
      (patch as Record<string, unknown>)[key] = next;
      filled.push(key);
    }
  }
  for (const flag of ["samplingRequired", "techPackAvailable", "referenceImageAvailable"] as const) {
    if (!existing[flag] && incoming[flag]) {
      patch[flag] = true;
      filled.push(flag);
    }
  }
  if (Number(existing.value) === 0 && Number(incoming.value) > 0) {
    patch.value = incoming.value;
    filled.push("value");
  }
  const newNotes = input.notes?.trim();
  if (newNotes) patch.notes = existing.notes ? `${existing.notes}\n\n[Merged enquiry] ${newNotes}` : newNotes;

  const existingTypeIds = new Set(existing.productInterests.map((p) => p.productTypeId));
  const addTypeIds = [...new Set(input.productInterestTypeIds ?? [])].filter((t) => !existingTypeIds.has(t));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { ...patch, lastActivityAt: now } });
    if (addTypeIds.length > 0) {
      await tx.crmLeadProductInterest.createMany({ data: addTypeIds.map((productTypeId) => ({ leadId: id, productTypeId })) });
    }
    await tx.crmActivity.create({
      data: {
        companyId: actor.companyId,
        relatedModule: "LEAD",
        relatedRecordId: id,
        activityType: "NOTE",
        subject: "Duplicate enquiry merged into this lead",
        body: [
          `From: ${[input.companyName, input.name, input.email, input.phone || input.whatsappNumber].filter(Boolean).join(" · ")}`,
          filled.length ? `Filled blank fields: ${filled.join(", ")}` : "No blank fields needed filling.",
          addTypeIds.length ? `Added ${addTypeIds.length} product interest(s).` : null,
          newNotes ? `Notes: ${newNotes}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        activityAt: now,
        performedByUserId: actor.userId,
      },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "crm_leads",
    recordId: id,
    action: "UPDATE",
    oldValues: Object.fromEntries(filled.map((k) => [k, (existing as Record<string, unknown>)[k] ?? null])),
    newValues: { mergedEnquiry: true, filledFields: filled, addedProductInterests: addTypeIds.length },
  });

  return getLeadById(actor.companyId, id);
}

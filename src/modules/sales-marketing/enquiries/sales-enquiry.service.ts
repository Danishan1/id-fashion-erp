import { Prisma, type BuyerEnquiry, type SalesEnquiryActivityType as DbActivityType } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createNotification } from "@/core/notifications/NotificationService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getTeamScope } from "@/core/hierarchy/team-scope";
import { branchScopeWhere } from "@/lib/branch-access";
import { todayIsoDate } from "@/lib/date";
import { createBuyerEnquiry } from "@/modules/buyer-enquiries/buyer-enquiry.service";
import { crmOwnerWhere, getCrmRecordScope, isWithinCrmScope, type CrmRecordScope } from "@/modules/crm/core/crm-visibility";
import { linkErpDocument, unlinkErpDocument } from "@/modules/crm/opportunities/crm-opportunity-erp.service";
import {
  OPEN_STAGE_KEYS,
  REOPEN_TARGET,
  REOPENABLE_STAGES,
  SALES_ENQUIRY_PRIORITY_KEYS,
  SALES_ENQUIRY_STAGES,
  STAGES_REQUIRING_REASON,
  canMoveTo,
  isClosedStage,
  type SalesEnquirySortField,
} from "./sales-enquiry-registry";
import {
  parseEnumList,
  salesEnquiryActivitySchema,
  salesEnquiryAssignSchema,
  salesEnquiryCreateSchema,
  salesEnquiryOpportunityLinkSchema,
  salesEnquiryReopenSchema,
  salesEnquiryStageChangeSchema,
  salesEnquiryUpdateSchema,
  SOURCE_KEYS,
  STAGE_KEYS,
  type SalesEnquiryListFilter,
} from "./sales-enquiry.schema";

/**
 * Sales Enquiries (Sales & Marketing Release 1 / S1, 2026-10-28).
 *
 * The record is the existing Buyer Enquiry (decision D1): Merchandising keeps
 * its line review and Sample conversion, Sales & Marketing adds the sales
 * lifecycle (`salesStage`), owner, priority, follow-up, CRM links,
 * qualification and an activity timeline. Merchandising's line-derived
 * `status` is never changed here.
 *
 * Visibility follows the CRM rule (same roles as CRM, decision of Phase 01):
 * `sales_marketing.view_all` sees every enquiry; `sales_marketing.view` sees
 * enquiries they own, those owned by their CRM team, and unassigned ones they
 * created. Branch-restricted users see only their branches. A record outside
 * the scope is NOT_FOUND.
 */

export interface SalesActor {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const OWNER_FIELDS = { owner: "ownerUserId", createdBy: "requestedByUserId" };
const TABLE = "buyer_enquiries";

const emptyToNull = (v: string | undefined | null) => (v === undefined ? undefined : v === "" || v === null ? null : v);
const dateOrNull = (v: string | undefined) => (v === undefined ? undefined : v ? new Date(v) : null);
const dateKey = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ── Scope ────────────────────────────────────────────────────────

export interface SalesEnquiryScope {
  record: CrmRecordScope;
  branch: ReturnType<typeof branchScopeWhere>;
}

export async function getSalesEnquiryScope(actor: SalesActor): Promise<SalesEnquiryScope> {
  const [canViewAll, allowedBranches] = await Promise.all([
    PermissionService.can(actor.userId, "sales_marketing", "view_all"),
    PermissionService.getAllowedBranchIds(actor.userId),
  ]);
  const record: CrmRecordScope = canViewAll
    ? { mode: "ALL" }
    : { mode: "OWN", userId: actor.userId, teamUserIds: (await getTeamScope(actor.userId, "CRM")).teamUserIds };
  return { record, branch: branchScopeWhere(allowedBranches) };
}

function scopedWhere(actor: SalesActor, scope: SalesEnquiryScope, extra: Prisma.BuyerEnquiryWhereInput = {}): Prisma.BuyerEnquiryWhereInput {
  return {
    AND: [{ companyId: actor.companyId }, scope.branch, crmOwnerWhere(scope.record, OWNER_FIELDS) as Prisma.BuyerEnquiryWhereInput, extra],
  };
}

async function loadVisible(actor: SalesActor, id: string): Promise<BuyerEnquiry> {
  const scope = await getSalesEnquiryScope(actor);
  const enquiry = await prisma.buyerEnquiry.findFirst({ where: scopedWhere(actor, scope, { id }) });
  if (!enquiry) throw new BusinessRuleError("NOT_FOUND", "Enquiry not found.", { id });
  return enquiry;
}

/** For sales changes: visible, and not cancelled in Merchandising. */
async function loadEditable(actor: SalesActor, id: string, verb: string): Promise<BuyerEnquiry> {
  const enquiry = await loadVisible(actor, id);
  if (enquiry.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This enquiry was cancelled in Merchandising — it can't be ${verb}.`);
  }
  return enquiry;
}

function assertOpen(enquiry: BuyerEnquiry, verb: string) {
  if (isClosedStage(enquiry.salesStage)) {
    const label = SALES_ENQUIRY_STAGES[enquiry.salesStage].label.toLowerCase();
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This enquiry is ${label}. Reopen it before ${verb}.`, { stage: enquiry.salesStage });
  }
}

/** Atomic "still at the stage I read" write — a concurrent change makes count 0. */
async function guardedUpdate(tx: Prisma.TransactionClient, enquiry: BuyerEnquiry, data: Prisma.BuyerEnquiryUncheckedUpdateManyInput) {
  const { count } = await tx.buyerEnquiry.updateMany({
    where: { id: enquiry.id, companyId: enquiry.companyId, salesStage: enquiry.salesStage, updatedAt: enquiry.updatedAt },
    data,
  });
  if (count === 0) {
    throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone else changed this enquiry just now. Reload and try again.", { id: enquiry.id });
  }
}

function activityData(
  enquiry: { id: string; companyId: string },
  actor: SalesActor,
  type: DbActivityType,
  body: string | null,
  metadata: Record<string, unknown> = {}
): Prisma.BuyerEnquiryActivityUncheckedCreateInput {
  return { companyId: enquiry.companyId, buyerEnquiryId: enquiry.id, type, body, metadata: metadata as Prisma.InputJsonValue, createdByUserId: actor.userId };
}

// ── Reference checks ─────────────────────────────────────────────

/** An owner must be an active user of this company who can use Sales & Marketing. */
async function assertEligibleOwner(actor: SalesActor, ownerUserId: string) {
  const user = await prisma.user.findFirst({
    where: { id: ownerUserId, companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null },
    select: { id: true, fullName: true },
  });
  if (!user || !(await PermissionService.can(user.id, "sales_marketing", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user who has access to Sales & Marketing.", {
      fieldErrors: { ownerUserId: "Not an eligible owner." },
    });
  }
  return user;
}

/** Users who can own an enquiry (active, with sales_marketing.view). */
export async function listEligibleOwners(actor: SalesActor) {
  const users = await prisma.user.findMany({
    where: { companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  const allowed = await Promise.all(users.map((u) => PermissionService.can(u.id, "sales_marketing", "view")));
  return users.filter((_, i) => allowed[i]);
}

/**
 * CRM company / contact links: the records must exist in this company, be
 * active (not archived or merged), be visible to the user in the CRM, agree
 * with each other, and — when both sides are linked to an ERP customer —
 * match the enquiry's customer. The user needs crm.view to set them.
 */
export async function assertCrmLinks(
  actor: SalesActor,
  links: { crmCompanyId: string | null; crmContactId: string | null; customerId: string | null }
) {
  if (!links.crmCompanyId && !links.crmContactId) return;
  if (!(await PermissionService.can(actor.userId, "crm", "view"))) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You need CRM access to link CRM records.");
  }
  const scope = await getCrmRecordScope({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null });
  if (links.crmCompanyId) {
    const company = await prisma.crmCompany.findFirst({
      where: { id: links.crmCompanyId, companyId: actor.companyId, archivedAt: null, mergedIntoId: null },
      select: { id: true, name: true, customerId: true, ownerUserId: true, createdByUserId: true },
    });
    if (!company || !isWithinCrmScope(scope, company)) {
      throw new BusinessRuleError("NOT_FOUND", "CRM company not found.", { id: links.crmCompanyId });
    }
    if (company.customerId && links.customerId && company.customerId !== links.customerId) {
      throw new BusinessRuleError("VALIDATION_ERROR", `CRM company ${company.name} is linked to a different ERP customer.`, {
        fieldErrors: { crmCompanyId: "Pick the CRM company of this enquiry's customer." },
      });
    }
  }
  if (links.crmContactId) {
    const contact = await prisma.crmContact.findFirst({
      where: { id: links.crmContactId, companyId: actor.companyId, archivedAt: null, mergedIntoId: null },
      select: { id: true, fullName: true, crmCompanyId: true, ownerUserId: true, createdByUserId: true },
    });
    if (!contact || !isWithinCrmScope(scope, contact)) {
      throw new BusinessRuleError("NOT_FOUND", "CRM contact not found.", { id: links.crmContactId });
    }
    if (links.crmCompanyId && contact.crmCompanyId && contact.crmCompanyId !== links.crmCompanyId) {
      throw new BusinessRuleError("VALIDATION_ERROR", `${contact.fullName} belongs to another CRM company.`, {
        fieldErrors: { crmContactId: "Pick a contact of the selected CRM company." },
      });
    }
  }
}

// ── List ─────────────────────────────────────────────────────────

export interface SalesEnquiryPage {
  skip: number;
  take: number;
  search?: string;
}

const LIST_INCLUDE = {
  customer: { select: { id: true, name: true } },
  buyer: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true } },
  crmCompany: { select: { id: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.BuyerEnquiryInclude;

function buildListWhere(actor: SalesActor, scope: SalesEnquiryScope, filter: SalesEnquiryListFilter, search?: string): Prisma.BuyerEnquiryWhereInput {
  const and: Prisma.BuyerEnquiryWhereInput[] = [];
  const stages = parseEnumList(filter.stage, STAGE_KEYS);
  if (stages.length) and.push({ salesStage: { in: stages } });
  else if (filter.view === "closed") and.push({ salesStage: { notIn: OPEN_STAGE_KEYS } });
  else if (filter.view !== "all") and.push({ salesStage: { in: OPEN_STAGE_KEYS }, status: { not: "CANCELLED" } });

  const priorities = parseEnumList(filter.priority, SALES_ENQUIRY_PRIORITY_KEYS);
  if (priorities.length) and.push({ priority: { in: priorities } });
  const sources = parseEnumList(filter.source, SOURCE_KEYS);
  if (sources.length) and.push({ source: { in: sources } });

  if (filter.owner === "me") and.push({ ownerUserId: actor.userId });
  else if (filter.owner === "unassigned") and.push({ ownerUserId: null });
  else if (filter.owner && /^[0-9a-f-]{36}$/i.test(filter.owner)) and.push({ ownerUserId: filter.owner });

  if (filter.overdue) {
    and.push({ nextFollowUpDate: { lt: new Date(todayIsoDate()) }, salesStage: { in: OPEN_STAGE_KEYS }, status: { not: "CANCELLED" } });
  }
  if (filter.dateFrom) and.push({ enquiryDate: { gte: new Date(filter.dateFrom) } });
  if (filter.dateTo) and.push({ enquiryDate: { lte: new Date(filter.dateTo) } });
  if (filter.crmCompanyId) and.push({ crmCompanyId: filter.crmCompanyId });
  if (filter.customerId) and.push({ customerId: filter.customerId });

  const term = search?.trim();
  if (term) {
    const c = { contains: term, mode: "insensitive" as const };
    and.push({
      OR: [{ enquiryNumber: c }, { subject: c }, { prospectName: c }, { customer: { name: c } }, { crmCompany: { name: c } }, { crmContact: { fullName: c } }],
    });
  }
  return scopedWhere(actor, scope, { AND: and });
}

function buildOrderBy(sortBy: SalesEnquirySortField, sortOrder: "asc" | "desc"): Prisma.BuyerEnquiryOrderByWithRelationInput[] {
  if (sortBy === "nextFollowUpDate") return [{ nextFollowUpDate: { sort: sortOrder, nulls: "last" } }, { enquiryDate: "desc" }];
  return [{ [sortBy]: sortOrder }, { createdAt: "desc" }];
}

export async function listSalesEnquiries(
  actor: SalesActor,
  filter: SalesEnquiryListFilter,
  sort: { sortBy: SalesEnquirySortField; sortOrder: "asc" | "desc" },
  page: SalesEnquiryPage
) {
  const scope = await getSalesEnquiryScope(actor);
  const where = buildListWhere(actor, scope, filter, page.search);
  const [rows, totalCount] = await Promise.all([
    prisma.buyerEnquiry.findMany({ where, include: LIST_INCLUDE, orderBy: buildOrderBy(sort.sortBy, sort.sortOrder), skip: page.skip, take: page.take }),
    prisma.buyerEnquiry.count({ where }),
  ]);
  const today = todayIsoDate();
  const data = rows.map((r) => ({
    ...r,
    isOverdue: Boolean(r.nextFollowUpDate && dateKey(r.nextFollowUpDate)! < today && !isClosedStage(r.salesStage) && r.status !== "CANCELLED"),
  }));
  return { data, totalCount };
}

// ── Detail ───────────────────────────────────────────────────────

export async function getSalesEnquiry(actor: SalesActor, id: string) {
  const scope = await getSalesEnquiryScope(actor);
  const enquiry = await prisma.buyerEnquiry.findFirst({
    where: scopedWhere(actor, scope, { id }),
    include: {
      customer: { select: { id: true, name: true, code: true } },
      buyer: { select: { id: true, name: true } },
      requestedBy: { select: { id: true, fullName: true } },
      owner: { select: { id: true, fullName: true } },
      crmCompany: { select: { id: true, name: true, archivedAt: true, mergedIntoId: true } },
      crmContact: { select: { id: true, fullName: true, archivedAt: true, mergedIntoId: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        include: {
          product: { select: { id: true, styleName: true, styleCode: true } },
          size: { select: { id: true, name: true } },
          sampleRequest: { select: { id: true, requestNumber: true, status: true } },
        },
      },
    },
  });
  if (!enquiry) throw new BusinessRuleError("NOT_FOUND", "Enquiry not found.", { id });

  const [activities, opportunities, canViewCrm] = await Promise.all([
    listActivities(enquiry.id),
    listLinkedOpportunities(actor, enquiry.id),
    PermissionService.can(actor.userId, "crm", "view"),
  ]);
  const today = todayIsoDate();
  return {
    ...enquiry,
    // CRM names are shown only to users who can open CRM.
    crmCompany: canViewCrm ? enquiry.crmCompany : enquiry.crmCompany ? { id: enquiry.crmCompany.id, name: "CRM company", archivedAt: null, mergedIntoId: null } : null,
    crmContact: canViewCrm ? enquiry.crmContact : enquiry.crmContact ? { id: enquiry.crmContact.id, fullName: "CRM contact", archivedAt: null, mergedIntoId: null } : null,
    isOverdue: Boolean(enquiry.nextFollowUpDate && dateKey(enquiry.nextFollowUpDate)! < today && !isClosedStage(enquiry.salesStage) && enquiry.status !== "CANCELLED"),
    activities,
    opportunities,
  };
}

function listActivities(buyerEnquiryId: string) {
  return prisma.buyerEnquiryActivity.findMany({
    where: { buyerEnquiryId },
    include: { createdBy: { select: { id: true, fullName: true } } },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function getSalesEnquiryActivities(actor: SalesActor, id: string) {
  const enquiry = await loadVisible(actor, id);
  return listActivities(enquiry.id);
}

/**
 * CRM opportunities linked to the enquiry (crm_opportunity_erp_links, doc type
 * BUYER_ENQUIRY — the CRM's own link table, not a copy). Only opportunities the
 * viewer can see in the CRM are named; the rest are counted.
 */
async function listLinkedOpportunities(actor: SalesActor, buyerEnquiryId: string) {
  const links = await prisma.crmOpportunityErpLink.findMany({
    where: { companyId: actor.companyId, docType: "BUYER_ENQUIRY", docId: buyerEnquiryId },
    include: {
      opportunity: {
        select: { id: true, opportunityNumber: true, name: true, status: true, amount: true, currencyCode: true, ownerUserId: true, createdByUserId: true, archivedAt: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (links.length === 0) return { visible: [], hiddenCount: 0 };
  const canViewCrm = await PermissionService.can(actor.userId, "crm", "view");
  const scope = canViewCrm ? await getCrmRecordScope({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }) : null;
  const visible = scope ? links.filter((l) => isWithinCrmScope(scope, l.opportunity)) : [];
  return {
    visible: visible.map((l) => ({
      linkId: l.id,
      linkedAt: l.createdAt,
      opportunity: {
        id: l.opportunity.id,
        opportunityNumber: l.opportunity.opportunityNumber,
        name: l.opportunity.name,
        status: l.opportunity.status,
        amount: l.opportunity.amount,
        currencyCode: l.opportunity.currencyCode,
        archived: Boolean(l.opportunity.archivedAt),
      },
    })),
    hiddenCount: links.length - visible.length,
  };
}

// ── Create ───────────────────────────────────────────────────────

export async function createSalesEnquiry(actor: SalesActor, raw: unknown) {
  const input = salesEnquiryCreateSchema.parse(raw);
  const ownerUserId = input.ownerUserId || actor.userId;
  const owner = await assertEligibleOwner(actor, ownerUserId);
  await assertCrmLinks(actor, { crmCompanyId: input.crmCompanyId || null, crmContactId: input.crmContactId || null, customerId: input.customerId || null });

  const enquiry = await createBuyerEnquiry(
    { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
    input,
    {
      subject: input.subject || null,
      priority: input.priority ?? "NORMAL",
      ownerUserId,
      nextFollowUpDate: input.nextFollowUpDate ? new Date(input.nextFollowUpDate) : null,
      crmCompanyId: input.crmCompanyId || null,
      crmContactId: input.crmContactId || null,
    }
  );

  if (ownerUserId !== actor.userId) await notifyOwner(actor, enquiry, owner.id);
  return enquiry;
}

async function notifyOwner(actor: SalesActor, enquiry: { id: string; enquiryNumber: string; subject?: string | null }, ownerUserId: string, db?: Prisma.TransactionClient) {
  await createNotification(
    {
      companyId: actor.companyId,
      userId: ownerUserId,
      title: `Enquiry ${enquiry.enquiryNumber} assigned to you`,
      body: enquiry.subject ? `${enquiry.subject} — open it in Sales & Marketing → Enquiries.` : "Open it in Sales & Marketing → Enquiries.",
      relatedModule: "BUYER_ENQUIRY",
      relatedRecordId: enquiry.id,
    },
    db
  );
}

// ── Edit details ─────────────────────────────────────────────────

const DETAIL_LABELS: Record<string, string> = {
  subject: "Subject",
  priority: "Priority",
  crmCompanyId: "CRM company",
  crmContactId: "CRM contact",
  estimatedValue: "Estimated value",
  expectedDecisionDate: "Expected decision date",
  nextAction: "Next action",
  qualificationNotes: "Qualification notes",
  remarks: "Remarks",
};

const comparable = (v: unknown) => (v instanceof Date ? dateKey(v) : v instanceof Prisma.Decimal ? v.toString() : v === undefined ? null : v);

export async function updateSalesEnquiryDetails(actor: SalesActor, id: string, raw: unknown) {
  const input = salesEnquiryUpdateSchema.parse(raw);
  const enquiry = await loadEditable(actor, id, "edited");
  assertOpen(enquiry, "editing it");

  const data: Prisma.BuyerEnquiryUncheckedUpdateManyInput = {};
  if (input.subject !== undefined) data.subject = emptyToNull(input.subject);
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.nextFollowUpDate !== undefined) data.nextFollowUpDate = dateOrNull(input.nextFollowUpDate);
  if (input.crmCompanyId !== undefined) data.crmCompanyId = emptyToNull(input.crmCompanyId);
  if (input.crmContactId !== undefined) data.crmContactId = emptyToNull(input.crmContactId);
  if (input.estimatedValue !== undefined) data.estimatedValue = input.estimatedValue === "" || input.estimatedValue === null ? null : new Prisma.Decimal(input.estimatedValue);
  if (input.expectedDecisionDate !== undefined) data.expectedDecisionDate = dateOrNull(input.expectedDecisionDate);
  if (input.nextAction !== undefined) data.nextAction = emptyToNull(input.nextAction);
  if (input.qualificationNotes !== undefined) data.qualificationNotes = emptyToNull(input.qualificationNotes);
  if (input.remarks !== undefined) data.remarks = emptyToNull(input.remarks);

  const crmCompanyId = data.crmCompanyId !== undefined ? (data.crmCompanyId as string | null) : enquiry.crmCompanyId;
  const crmContactId = data.crmContactId !== undefined ? (data.crmContactId as string | null) : enquiry.crmContactId;
  const crmChanged = crmCompanyId !== enquiry.crmCompanyId || crmContactId !== enquiry.crmContactId;
  if (crmChanged) await assertCrmLinks(actor, { crmCompanyId, crmContactId, customerId: enquiry.customerId });

  // Only fields whose value actually changes are written and logged.
  const before = enquiry as unknown as Record<string, unknown>;
  const changed = Object.keys(data).filter((k) => comparable(before[k]) !== comparable((data as Record<string, unknown>)[k]));
  if (changed.length === 0) return getSalesEnquiry(actor, id);
  const patch = Object.fromEntries(changed.map((k) => [k, (data as Record<string, unknown>)[k]])) as Prisma.BuyerEnquiryUncheckedUpdateManyInput;

  await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, enquiry, patch);
    const followUpChanged = changed.includes("nextFollowUpDate");
    const others = changed.filter((k) => k !== "nextFollowUpDate");
    if (followUpChanged) {
      await tx.buyerEnquiryActivity.create({
        data: activityData(enquiry, actor, "FOLLOW_UP_CHANGED", null, { from: dateKey(enquiry.nextFollowUpDate), to: dateKey(patch.nextFollowUpDate as Date | null) }),
      });
    }
    if (others.length) {
      await tx.buyerEnquiryActivity.create({
        data: activityData(enquiry, actor, "DETAILS_UPDATED", others.map((k) => DETAIL_LABELS[k] ?? k).join(", "), { fields: others }),
      });
    }
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: TABLE,
        recordId: enquiry.id,
        action: "UPDATE",
        oldValues: Object.fromEntries(changed.map((k) => [k, comparable(before[k])])),
        newValues: Object.fromEntries(changed.map((k) => [k, comparable((patch as Record<string, unknown>)[k])])),
      },
      tx
    );
  });
  return getSalesEnquiry(actor, id);
}

// ── Stage ────────────────────────────────────────────────────────

export async function changeSalesEnquiryStage(actor: SalesActor, id: string, raw: unknown) {
  const input = salesEnquiryStageChangeSchema.parse(raw);
  const enquiry = await loadEditable(actor, id, "moved");
  const from = enquiry.salesStage;
  const to = input.stage;
  if (!canMoveTo(from, to)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `An enquiry that is ${SALES_ENQUIRY_STAGES[from].label.toLowerCase()} can't be moved to ${SALES_ENQUIRY_STAGES[to].label.toLowerCase()}.`,
      { from, to }
    );
  }
  const reason = input.reason || null;
  if (STAGES_REQUIRING_REASON.includes(to) && !reason) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Give a reason for marking this enquiry ${SALES_ENQUIRY_STAGES[to].label.toLowerCase()}.`, {
      fieldErrors: { reason: "Required." },
    });
  }

  const now = new Date();
  const data: Prisma.BuyerEnquiryUncheckedUpdateManyInput = { salesStage: to, stageChangedAt: now };
  if (to === "ON_HOLD") data.stageBeforeHold = from;
  if (from === "ON_HOLD") data.stageBeforeHold = null;
  if (isClosedStage(to)) {
    data.closedAt = now;
    data.closureReason = reason;
  }

  await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, enquiry, data);
    await tx.buyerEnquiryActivity.create({ data: activityData(enquiry, actor, "STAGE_CHANGED", reason, { from, to }) });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: enquiry.id, action: "UPDATE", oldValues: { salesStage: from }, newValues: { salesStage: to, reason } },
      tx
    );
  });
  return getSalesEnquiry(actor, id);
}

/** ON_HOLD → back to exactly the stage it was held from (never a caller-chosen stage). */
export async function resumeSalesEnquiry(actor: SalesActor, id: string) {
  const enquiry = await loadEditable(actor, id, "resumed");
  if (enquiry.salesStage !== "ON_HOLD") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Only an enquiry on hold can be resumed.");
  const to = enquiry.stageBeforeHold && !isClosedStage(enquiry.stageBeforeHold) && enquiry.stageBeforeHold !== "ON_HOLD" ? enquiry.stageBeforeHold : "UNDER_REVIEW";
  await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, enquiry, { salesStage: to, stageBeforeHold: null, stageChangedAt: new Date() });
    await tx.buyerEnquiryActivity.create({ data: activityData(enquiry, actor, "STAGE_CHANGED", null, { from: "ON_HOLD", to, resumed: true }) });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: enquiry.id, action: "UPDATE", oldValues: { salesStage: "ON_HOLD" }, newValues: { salesStage: to } },
      tx
    );
  });
  return getSalesEnquiry(actor, id);
}

/** LOST / NOT_QUALIFIED → UNDER_REVIEW, with a required reason (audited). The old closure reason is kept for history. */
export async function reopenSalesEnquiry(actor: SalesActor, id: string, raw: unknown) {
  const { reason } = salesEnquiryReopenSchema.parse(raw);
  const enquiry = await loadEditable(actor, id, "reopened");
  if (!REOPENABLE_STAGES.includes(enquiry.salesStage)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      enquiry.salesStage === "WON" ? "A won enquiry has a Sales Order and can't be reopened." : "Only a lost or not-qualified enquiry can be reopened."
    );
  }
  await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, enquiry, { salesStage: REOPEN_TARGET, stageChangedAt: new Date(), closedAt: null });
    await tx.buyerEnquiryActivity.create({
      data: activityData(enquiry, actor, "STAGE_CHANGED", reason, { from: enquiry.salesStage, to: REOPEN_TARGET, reopened: true }),
    });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: TABLE,
        recordId: enquiry.id,
        action: "UPDATE",
        oldValues: { salesStage: enquiry.salesStage, closureReason: enquiry.closureReason },
        newValues: { salesStage: REOPEN_TARGET, reopenReason: reason },
      },
      tx
    );
  });
  return getSalesEnquiry(actor, id);
}

// ── Owner ────────────────────────────────────────────────────────

export async function assignSalesEnquiry(actor: SalesActor, id: string, raw: unknown) {
  const input = salesEnquiryAssignSchema.parse(raw);
  const enquiry = await loadEditable(actor, id, "reassigned");
  assertOpen(enquiry, "reassigning it");
  const ownerUserId = input.ownerUserId || null;
  if (ownerUserId === enquiry.ownerUserId) return getSalesEnquiry(actor, id);
  const owner = ownerUserId ? await assertEligibleOwner(actor, ownerUserId) : null;
  const previous = enquiry.ownerUserId
    ? await prisma.user.findFirst({ where: { id: enquiry.ownerUserId }, select: { fullName: true } })
    : null;

  await prisma.$transaction(async (tx) => {
    await guardedUpdate(tx, enquiry, { ownerUserId });
    await tx.buyerEnquiryActivity.create({
      data: activityData(enquiry, actor, "OWNER_CHANGED", null, {
        fromUserId: enquiry.ownerUserId,
        fromName: previous?.fullName ?? null,
        toUserId: ownerUserId,
        toName: owner?.fullName ?? null,
      }),
    });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: enquiry.id, action: "UPDATE", oldValues: { ownerUserId: enquiry.ownerUserId }, newValues: { ownerUserId } },
      tx
    );
    if (owner && owner.id !== actor.userId) await notifyOwner(actor, enquiry, owner.id, tx);
  });
  // Handing an enquiry to someone outside your own scope means you can no longer see it.
  return getSalesEnquiry(actor, id).catch((error) => {
    if (error instanceof BusinessRuleError && error.code === "NOT_FOUND") return { id, visible: false as const };
    throw error;
  });
}

// ── Activity (notes and interactions) ────────────────────────────

export async function addSalesEnquiryActivity(actor: SalesActor, id: string, raw: unknown) {
  const input = salesEnquiryActivitySchema.parse(raw);
  // Notes stay possible on closed enquiries (e.g. "customer came back"), but not on cancelled ones.
  const enquiry = await loadEditable(actor, id, "updated");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new BusinessRuleError("VALIDATION_ERROR", "An interaction can't be in the future — use the follow-up date to plan one.", {
      fieldErrors: { occurredAt: "In the future." },
    });
  }
  return prisma.$transaction(async (tx) => {
    const activity = await tx.buyerEnquiryActivity.create({
      data: { ...activityData(enquiry, actor, input.type, input.body), occurredAt },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    await writeAuditLog(
      { companyId: actor.companyId, userId: actor.userId, tableName: "buyer_enquiry_activities", recordId: activity.id, action: "CREATE", newValues: { buyerEnquiryId: enquiry.id, type: input.type } },
      tx
    );
    return activity;
  });
}

// ── CRM opportunity links (CRM's own link table) ─────────────────

async function assertCanEditCrm(actor: SalesActor) {
  if (!(await PermissionService.can(actor.userId, "crm", "edit"))) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You need CRM edit access to link opportunities.");
  }
}

export async function linkSalesEnquiryOpportunity(actor: SalesActor, id: string, raw: unknown) {
  const { opportunityId } = salesEnquiryOpportunityLinkSchema.parse(raw);
  const enquiry = await loadEditable(actor, id, "linked");
  await assertCanEditCrm(actor);
  // The CRM service checks the opportunity's visibility, that it isn't archived,
  // buyer_enquiries.view + branch access, customer match and duplicates.
  const link = await linkErpDocument({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, opportunityId, {
    docType: "BUYER_ENQUIRY",
    docId: enquiry.id,
  });
  const opp = await prisma.crmOpportunity.findFirst({ where: { id: opportunityId, companyId: actor.companyId }, select: { opportunityNumber: true, name: true } });
  await prisma.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "OPPORTUNITY_LINKED", opp ? `${opp.opportunityNumber} · ${opp.name}` : null, { opportunityId, linkId: link.id }),
  });
  return getSalesEnquiry(actor, id);
}

export async function unlinkSalesEnquiryOpportunity(actor: SalesActor, id: string, linkId: string) {
  const enquiry = await loadEditable(actor, id, "changed");
  await assertCanEditCrm(actor);
  const link = await prisma.crmOpportunityErpLink.findFirst({
    where: { id: linkId, companyId: actor.companyId, docType: "BUYER_ENQUIRY", docId: enquiry.id },
    include: { opportunity: { select: { opportunityNumber: true, name: true } } },
  });
  if (!link) throw new BusinessRuleError("NOT_FOUND", "This opportunity is not linked to the enquiry.", { id: linkId });
  await unlinkErpDocument({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, link.opportunityId, link.id);
  await prisma.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "OPPORTUNITY_UNLINKED", `${link.opportunity.opportunityNumber} · ${link.opportunity.name}`, { opportunityId: link.opportunityId }),
  });
  return getSalesEnquiry(actor, id);
}

/** Record-attachments visibility hook: NOT_FOUND unless the enquiry is in the user's Sales & Marketing scope. */
export async function assertSalesEnquiryVisible(actor: { companyId: string; userId: string }, id: string): Promise<void> {
  await loadVisible(actor, id);
}

// ── Quotation hooks (S2) ─────────────────────────────────────────
// Quotations move the enquiry through the system stages; nothing else may.

/** Stages from which a quotation can be started. */
export const QUOTABLE_STAGES = ["NEW", "UNDER_REVIEW", "QUALIFIED", "QUOTATION_IN_PROGRESS", "QUOTED"] as const;

/**
 * Loads an enquiry a quotation is being made from: in the user's Sales &
 * Marketing scope, not cancelled, and at a quotable stage.
 */
export async function loadEnquiryForQuotation(actor: SalesActor, id: string) {
  await PermissionService.assert(actor.userId, "sales_marketing", "view");
  const enquiry = await loadEditable(actor, id, "quoted");
  if (!(QUOTABLE_STAGES as readonly string[]).includes(enquiry.salesStage)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `This enquiry is ${SALES_ENQUIRY_STAGES[enquiry.salesStage].label.toLowerCase()} — ${enquiry.salesStage === "ON_HOLD" ? "resume" : "reopen"} it before quoting.`,
      { stage: enquiry.salesStage }
    );
  }
  return enquiry;
}

/** Inside the quotation's transaction: NEW / UNDER_REVIEW / QUALIFIED → QUOTATION_IN_PROGRESS. */
export async function markEnquiryQuotationStarted(tx: Prisma.TransactionClient, actor: SalesActor, enquiryId: string, quotationNumber: string) {
  const enquiry = await tx.buyerEnquiry.findFirst({ where: { id: enquiryId, companyId: actor.companyId } });
  if (!enquiry || !["NEW", "UNDER_REVIEW", "QUALIFIED"].includes(enquiry.salesStage)) return;
  await guardedUpdate(tx, enquiry, { salesStage: "QUOTATION_IN_PROGRESS", stageChangedAt: new Date() });
  await tx.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "STAGE_CHANGED", `Quotation ${quotationNumber} started`, { from: enquiry.salesStage, to: "QUOTATION_IN_PROGRESS", quotationNumber }),
  });
}

/**
 * Inside the quotation's transaction, after a quotation stops being open: if
 * the enquiry is QUOTATION_IN_PROGRESS and has no other open quotation, it goes
 * back to QUALIFIED.
 */
export async function releaseEnquiryQuotation(tx: Prisma.TransactionClient, actor: SalesActor, enquiryId: string, quotationNumber: string, openStatuses: readonly string[]) {
  const enquiry = await tx.buyerEnquiry.findFirst({ where: { id: enquiryId, companyId: actor.companyId } });
  if (!enquiry || !["QUOTATION_IN_PROGRESS", "QUOTED"].includes(enquiry.salesStage)) return;
  const stillOpen = await tx.quotation.count({ where: { buyerEnquiryId: enquiryId, status: { in: openStatuses as never } } });
  if (stillOpen > 0) return;
  await guardedUpdate(tx, enquiry, { salesStage: "QUALIFIED", stageChangedAt: new Date() });
  await tx.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "STAGE_CHANGED", `Quotation ${quotationNumber} cancelled`, { from: enquiry.salesStage, to: "QUALIFIED", quotationNumber }),
  });
}

/** Inside the quotation's transaction when a quotation is issued: the enquiry becomes QUOTED (from any open stage before it). */
export async function markEnquiryQuoted(tx: Prisma.TransactionClient, actor: SalesActor, enquiryId: string, quotationNumber: string, revisionNumber: number) {
  const enquiry = await tx.buyerEnquiry.findFirst({ where: { id: enquiryId, companyId: actor.companyId } });
  if (!enquiry || !["NEW", "UNDER_REVIEW", "QUALIFIED", "QUOTATION_IN_PROGRESS"].includes(enquiry.salesStage)) return;
  await guardedUpdate(tx, enquiry, { salesStage: "QUOTED", stageChangedAt: new Date() });
  await tx.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "STAGE_CHANGED", `Quotation ${quotationNumber} rev ${revisionNumber} issued`, { from: enquiry.salesStage, to: "QUOTED", quotationNumber }),
  });
}


/**
 * Inside the conversion's transaction (S4): a real Sales Order now exists, so
 * the enquiry is WON — the only way it can be. Skipped if it is already
 * closed (e.g. marked lost while another quotation of it was accepted).
 */
export async function markEnquiryWon(tx: Prisma.TransactionClient, actor: SalesActor, enquiryId: string, orderNumber: string, quotationNumber: string) {
  const enquiry = await tx.buyerEnquiry.findFirst({ where: { id: enquiryId, companyId: actor.companyId } });
  if (!enquiry || isClosedStage(enquiry.salesStage)) return;
  const now = new Date();
  await guardedUpdate(tx, enquiry, {
    salesStage: "WON",
    stageChangedAt: now,
    stageBeforeHold: null,
    closedAt: now,
    closureReason: `Sales Order ${orderNumber} from quotation ${quotationNumber}`,
  });
  await tx.buyerEnquiryActivity.create({
    data: activityData(enquiry, actor, "STAGE_CHANGED", `Sales Order ${orderNumber} created from quotation ${quotationNumber}`, {
      from: enquiry.salesStage,
      to: "WON",
      orderNumber,
      quotationNumber,
    }),
  });
}

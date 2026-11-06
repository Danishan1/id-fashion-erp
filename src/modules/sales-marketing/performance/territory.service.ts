import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { canSeeTerritory, getPerformanceScope } from "./performance-actuals";
import { auditPerformance, blank, dbDate, isoDateSchema, listPerformanceEvents, optionalText, recordPerformanceEvent, toDbDate } from "./performance-common";

/**
 * Sales territories (Phase 05, PHASE_05 §2): a flat list, rep assignments
 * with dates, one territory per customer. Managed with sales_performance.edit;
 * readable with sales_performance.view.
 */

const TABLE = "sales_territories";

export const territoryCreateSchema = z
  .object({
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    name: z.string().trim().min(1, "Enter a name").max(200),
    description: optionalText(1000),
  })
  .strict();
export const territoryUpdateSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(200), description: optionalText(1000) }).strict();
export const assignmentCreateSchema = z
  .object({
    userId: z.string().uuid("Choose a person"),
    isPrimary: z.boolean().default(false),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional().or(z.literal("")).nullable(),
  })
  .strict();
export const assignmentEndSchema = z.object({ endDate: isoDateSchema }).strict();
export const customerAssignSchema = z
  .object({
    customerIds: z.array(z.string().uuid()).min(1, "Choose at least one customer").max(500),
    /** Customers already in another territory move only when this is true. */
    move: z.boolean().default(false),
  })
  .strict();

const overlaps = (a: { start: string; end: string | null }, b: { start: string; end: string | null }) =>
  a.start <= (b.end ?? "9999-12-31") && b.start <= (a.end ?? "9999-12-31");

function uniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new BusinessRuleError("VALIDATION_ERROR", "A territory with this code already exists.", { fieldErrors: { code: "Already used." } });
  }
  throw error;
}

async function loadTerritory(actor: SalesActor, id: string) {
  const t = await prisma.salesTerritory.findFirst({ where: { id, companyId: actor.companyId } });
  if (!t) throw new BusinessRuleError("NOT_FOUND", "Territory not found.", { id });
  return t;
}

export async function createTerritory(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = territoryCreateSchema.parse(raw);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const t = await tx.salesTerritory.create({
        data: { companyId: actor.companyId, code: input.code.toUpperCase(), name: input.name, description: blank(input.description), createdByUserId: actor.userId },
      });
      await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "TERRITORY_CREATED", null, { code: t.code, name: t.name });
      await auditPerformance(tx, actor, TABLE, t.id, "CREATE", null, { code: t.code, name: t.name, description: t.description });
      return t;
    });
    return getTerritory(actor, created.id);
  } catch (error) {
    uniqueViolation(error);
  }
}

export async function updateTerritory(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = territoryUpdateSchema.parse(raw);
  const t = await loadTerritory(actor, id);
  await prisma.$transaction(async (tx) => {
    await tx.salesTerritory.updateMany({ where: { id: t.id, companyId: actor.companyId }, data: { name: input.name, description: blank(input.description) } });
    await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "TERRITORY_UPDATED", null, { name: input.name });
    await auditPerformance(tx, actor, TABLE, t.id, "UPDATE", { name: t.name, description: t.description }, input);
  });
  return getTerritory(actor, id);
}

export async function territoryAction(actor: SalesActor, id: string, action: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  if (action !== "deactivate" && action !== "reactivate") throw new BusinessRuleError("NOT_FOUND", "Unknown territory action.", { action });
  const t = await loadTerritory(actor, id);
  const isActive = action === "reactivate";
  if (t.isActive === isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", `This territory is already ${isActive ? "active" : "inactive"}.`);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.salesTerritory.updateMany({ where: { id: t.id, companyId: actor.companyId, isActive: t.isActive }, data: { isActive } });
    if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "This territory changed just now. Reload and try again.");
    await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, isActive ? "TERRITORY_REACTIVATED" : "TERRITORY_DEACTIVATED");
    await auditPerformance(tx, actor, TABLE, t.id, "UPDATE", { isActive: t.isActive }, { isActive });
  });
  return getTerritory(actor, id);
}

// ── Rep assignments ──────────────────────────────────────────────

/** A rep must be an active login of this company who works in Sales & Marketing. */
export async function assertEligibleRep(actor: SalesActor, userId: string, field = "userId") {
  const user = await prisma.user.findFirst({ where: { id: userId, companyId: actor.companyId, status: "ACTIVE", supportForPlatformUserId: null }, select: { id: true, fullName: true } });
  if (!user) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user of this company.", { fieldErrors: { [field]: "Not an active user." } });
  if (!(await PermissionService.can(userId, "sales_marketing", "view"))) {
    throw new BusinessRuleError("VALIDATION_ERROR", `${user.fullName} doesn't have access to Sales & Marketing.`, { fieldErrors: { [field]: "No Sales & Marketing access." } });
  }
  return user;
}

export async function addAssignment(actor: SalesActor, territoryId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = assignmentCreateSchema.parse(raw);
  const t = await loadTerritory(actor, territoryId);
  if (!t.isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Reactivate the territory before assigning reps.");
  const end = blank(input.endDate);
  if (end && end < input.startDate) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { endDate: "Before the start date." } });
  const user = await assertEligibleRep(actor, input.userId);
  const range = { start: input.startDate, end };

  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.salesTerritoryAssignment.findMany({ where: { territoryId: t.id }, include: { user: { select: { fullName: true } } } });
      for (const a of existing) {
        const other = { start: dbDate(a.startDate), end: a.endDate ? dbDate(a.endDate) : null };
        if (!overlaps(range, other)) continue;
        if (a.userId === input.userId) {
          throw new BusinessRuleError("VALIDATION_ERROR", `${user.fullName} is already assigned to this territory for part of those dates.`, { fieldErrors: { startDate: "Overlaps an existing assignment." } });
        }
        if (input.isPrimary && a.isPrimary) {
          throw new BusinessRuleError("VALIDATION_ERROR", `${a.user.fullName} is already the primary rep for part of those dates. End that assignment first, or add this one as a supporting rep.`, {
            fieldErrors: { isPrimary: "Another primary rep overlaps." },
          });
        }
      }
      const created = await tx.salesTerritoryAssignment.create({
        data: { companyId: actor.companyId, territoryId: t.id, userId: input.userId, isPrimary: input.isPrimary, startDate: toDbDate(input.startDate), endDate: end ? toDbDate(end) : null, createdByUserId: actor.userId },
      });
      await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "REP_ASSIGNED", null, { assignmentId: created.id, user: user.fullName, isPrimary: input.isPrimary, startDate: input.startDate, endDate: end });
      await auditPerformance(tx, actor, "sales_territory_assignments", created.id, "CREATE", null, { territoryId: t.id, userId: input.userId, isPrimary: input.isPrimary, startDate: input.startDate, endDate: end });
    },
    { isolationLevel: "Serializable" }
  );
  return getTerritory(actor, territoryId);
}

async function loadAssignment(actor: SalesActor, territoryId: string, assignmentId: string) {
  const a = await prisma.salesTerritoryAssignment.findFirst({ where: { id: assignmentId, territoryId, companyId: actor.companyId }, include: { user: { select: { fullName: true } } } });
  if (!a) throw new BusinessRuleError("NOT_FOUND", "Assignment not found.", { assignmentId });
  return a;
}

export async function endAssignment(actor: SalesActor, territoryId: string, assignmentId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const { endDate } = assignmentEndSchema.parse(raw);
  const a = await loadAssignment(actor, territoryId, assignmentId);
  const start = dbDate(a.startDate);
  if (endDate < start) throw new BusinessRuleError("VALIDATION_ERROR", "The end date is before the start date.", { fieldErrors: { endDate: "Before the start date." } });
  if (a.endDate && endDate > dbDate(a.endDate)) throw new BusinessRuleError("VALIDATION_ERROR", "An assignment can only be ended earlier, not extended. Add a new assignment instead.", { fieldErrors: { endDate: "Later than the current end." } });
  await prisma.$transaction(async (tx) => {
    await tx.salesTerritoryAssignment.updateMany({ where: { id: a.id, companyId: actor.companyId }, data: { endDate: toDbDate(endDate) } });
    await recordPerformanceEvent(tx, actor, "TERRITORY", territoryId, "REP_ASSIGNMENT_ENDED", null, { assignmentId: a.id, user: a.user.fullName, endDate });
    await auditPerformance(tx, actor, "sales_territory_assignments", a.id, "UPDATE", { endDate: a.endDate ? dbDate(a.endDate) : null }, { endDate });
  });
  return getTerritory(actor, territoryId);
}

/** Only an assignment that hasn't started yet can be removed; others are ended. */
export async function removeAssignment(actor: SalesActor, territoryId: string, assignmentId: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const a = await loadAssignment(actor, territoryId, assignmentId);
  if (dbDate(a.startDate) <= todayIsoDate()) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This assignment has already started. End it instead, so its history is kept.");
  await prisma.$transaction(async (tx) => {
    await tx.salesTerritoryAssignment.deleteMany({ where: { id: a.id, companyId: actor.companyId } });
    await recordPerformanceEvent(tx, actor, "TERRITORY", territoryId, "REP_ASSIGNMENT_REMOVED", null, { user: a.user.fullName, startDate: dbDate(a.startDate) });
    await auditPerformance(tx, actor, "sales_territory_assignments", a.id, "DELETE", { userId: a.userId, startDate: dbDate(a.startDate) }, null);
  });
  return getTerritory(actor, territoryId);
}

// ── Customers ────────────────────────────────────────────────────

export async function assignCustomers(actor: SalesActor, territoryId: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const input = customerAssignSchema.parse(raw);
  const t = await loadTerritory(actor, territoryId);
  if (!t.isActive) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Reactivate the territory before adding customers.");
  const ids = [...new Set(input.customerIds)];
  const customers = await prisma.customer.findMany({
    where: { id: { in: ids }, companyId: actor.companyId, deletedAt: null },
    select: { id: true, name: true, salesTerritoryId: true, salesTerritory: { select: { name: true } } },
  });
  if (customers.length !== ids.length) throw new BusinessRuleError("NOT_FOUND", "One or more customers were not found.");
  const elsewhere = customers.filter((c) => c.salesTerritoryId && c.salesTerritoryId !== t.id);
  if (elsewhere.length && !input.move) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Already in another territory: ${elsewhere
        .slice(0, 5)
        .map((c) => `${c.name} (${c.salesTerritory?.name})`)
        .join(", ")}${elsewhere.length > 5 ? ` and ${elsewhere.length - 5} more` : ""}. Tick "Move them here" to move them.`,
      { conflicts: elsewhere.map((c) => c.id) }
    );
  }
  const toChange = customers.filter((c) => c.salesTerritoryId !== t.id);
  await prisma.$transaction(async (tx) => {
    for (const c of toChange) {
      const { count } = await tx.customer.updateMany({ where: { id: c.id, companyId: actor.companyId, salesTerritoryId: c.salesTerritoryId }, data: { salesTerritoryId: t.id } });
      if (count === 0) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", `${c.name} changed just now. Reload and try again.`);
      await auditPerformance(tx, actor, "customers", c.id, "UPDATE", { salesTerritoryId: c.salesTerritoryId }, { salesTerritoryId: t.id });
      if (c.salesTerritoryId) {
        await recordPerformanceEvent(tx, actor, "TERRITORY", c.salesTerritoryId, "CUSTOMER_REMOVED", null, { customer: c.name, movedTo: t.name });
        await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "CUSTOMER_MOVED", null, { customer: c.name, from: c.salesTerritory?.name });
      } else {
        await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "CUSTOMER_ASSIGNED", null, { customer: c.name });
      }
    }
  });
  return getTerritory(actor, territoryId);
}

export async function removeCustomer(actor: SalesActor, territoryId: string, customerId: string) {
  await PermissionService.assert(actor.userId, "sales_performance", "edit");
  const t = await loadTerritory(actor, territoryId);
  const c = await prisma.customer.findFirst({ where: { id: customerId, companyId: actor.companyId, salesTerritoryId: t.id }, select: { id: true, name: true } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "This customer isn't in this territory.", { customerId });
  await prisma.$transaction(async (tx) => {
    await tx.customer.updateMany({ where: { id: c.id, companyId: actor.companyId, salesTerritoryId: t.id }, data: { salesTerritoryId: null } });
    await recordPerformanceEvent(tx, actor, "TERRITORY", t.id, "CUSTOMER_REMOVED", null, { customer: c.name });
    await auditPerformance(tx, actor, "customers", c.id, "UPDATE", { salesTerritoryId: t.id }, { salesTerritoryId: null });
  });
  return getTerritory(actor, territoryId);
}

/** Customers matching a search, with their current territory (for the "Add customers" picker). */
export async function searchCustomersForTerritory(actor: SalesActor, search: string) {
  const term = search.trim();
  const rows = await prisma.customer.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      isActive: true,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }, { city: { contains: term, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, code: true, name: true, city: true, country: true, salesTerritory: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
    take: 50,
  });
  return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, city: c.city, country: c.country, territory: c.salesTerritory }));
}

// ── Read ─────────────────────────────────────────────────────────

const activeOn = (today: Date): Prisma.SalesTerritoryAssignmentWhereInput => ({ startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] });

export const territoryFilterSchema = z.object({ status: z.enum(["active", "inactive", "all"]).optional().or(z.literal("")) });

export async function listTerritories(actor: SalesActor, raw: unknown, page: { skip: number; take: number; search?: string }) {
  const f = territoryFilterSchema.parse(raw ?? {});
  const and: Prisma.SalesTerritoryWhereInput[] = [{ companyId: actor.companyId }];
  if (!f.status || f.status === "active") and.push({ isActive: true });
  else if (f.status === "inactive") and.push({ isActive: false });
  const term = page.search?.trim();
  if (term) and.push({ OR: [{ code: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] });
  const where = { AND: and };
  const today = toDbDate(todayIsoDate());
  const [rows, total] = await Promise.all([
    prisma.salesTerritory.findMany({
      where,
      orderBy: { code: "asc" },
      skip: page.skip,
      take: page.take,
      include: {
        _count: { select: { customers: true } },
        assignments: { where: activeOn(today), include: { user: { select: { fullName: true } } }, orderBy: [{ isPrimary: "desc" }, { startDate: "asc" }] },
      },
    }),
    prisma.salesTerritory.count({ where }),
  ]);
  return {
    data: rows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      active: t.isActive,
      customers: t._count.customers,
      primaryRep: t.assignments.find((a) => a.isPrimary)?.user.fullName ?? null,
      reps: t.assignments.map((a) => a.user.fullName),
    })),
    total,
  };
}

/** Active territories for pickers. */
export async function listTerritoryOptions(actor: SalesActor) {
  return prisma.salesTerritory.findMany({ where: { companyId: actor.companyId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
}

export async function getTerritory(actor: SalesActor, id: string) {
  const t = await prisma.salesTerritory.findFirst({
    where: { id, companyId: actor.companyId },
    include: {
      createdBy: { select: { fullName: true } },
      assignments: { include: { user: { select: { id: true, fullName: true, status: true } } }, orderBy: [{ startDate: "desc" }] },
      customers: { where: { deletedAt: null }, select: { id: true, code: true, name: true, city: true, country: true, isActive: true }, orderBy: { name: "asc" } },
    },
  });
  if (!t) throw new BusinessRuleError("NOT_FOUND", "Territory not found.", { id });
  const today = todayIsoDate();
  const [events, scope] = await Promise.all([listPerformanceEvents(prisma, actor.companyId, "TERRITORY", t.id), getPerformanceScope(actor)]);
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    description: t.description,
    active: t.isActive,
    createdBy: t.createdBy.fullName,
    createdAt: t.createdAt.toISOString(),
    canSeePerformance: canSeeTerritory(scope, t.id),
    assignments: t.assignments.map((a) => {
      const start = dbDate(a.startDate);
      const end = a.endDate ? dbDate(a.endDate) : null;
      return {
        id: a.id,
        userId: a.userId,
        user: a.user.fullName,
        userActive: a.user.status === "ACTIVE",
        isPrimary: a.isPrimary,
        startDate: start,
        endDate: end,
        state: start > today ? ("UPCOMING" as const) : end && end < today ? ("ENDED" as const) : ("CURRENT" as const),
      };
    }),
    customers: t.customers,
    events,
  };
}

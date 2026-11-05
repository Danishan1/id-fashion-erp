import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { addCalendarDays, businessDayEnd, businessDayStart, businessToday } from "@/modules/crm/core/crm-dates";
import { crmOwnerWhere, getCrmRecordScope, type CrmRecordScope } from "@/modules/crm/core/crm-visibility";
import { bookedOrderSql, bookedOrderWhere } from "@/modules/sales-marketing/performance/performance-actuals";
import {
  OPERATORS,
  fieldDef,
  validateCriteria,
  type EligibilityChannelKey,
  type EntryReasonKey,
  type SegmentCondition,
  type SegmentCriteria,
  type SegmentSourceKey,
} from "./segment-registry";

/**
 * Server-side segment query builder (Phase 09). Turns a VALIDATED criteria
 * object into a Prisma `where` for one source table. Only allow-listed fields
 * map to columns (FIELD_COLUMNS / special handlers below); values are always
 * passed as Prisma parameters, never concatenated. Every where is combined
 * with `baseWhere()` — company, not archived / merged / deleted, and the
 * running user's own record visibility (CRM own / team / all; customers need
 * masters_core.view).
 */

type Db = Prisma.TransactionClient | typeof prisma;
// One loose shape for the four sources' where inputs; every value built here is a valid Prisma filter for its source.
export type W = Record<string, unknown>;

export const MAX_EVALUATION_RECORDS = 200_000;
export const MAX_STATIC_MEMBERS = 20_000;
export const MAX_MANUAL_EXCLUSIONS = 5_000;
const MAX_ID_SET = 100_000;

export interface SegmentAccess {
  companyId: string;
  userId: string;
  source: SegmentSourceKey;
  /** CRM sources only. */
  crmScope: CrmRecordScope | null;
}

/** The running user's access to a source: CRM view (own / team / all) or Customers (masters_core.view). */
export async function getSegmentAccess(companyId: string, userId: string, source: SegmentSourceKey): Promise<SegmentAccess> {
  if (source === "CUSTOMER") {
    if (!(await PermissionService.can(userId, "masters_core", "view"))) throw new BusinessRuleError("PERMISSION_DENIED", "Segments of ERP customers need access to the Customer master.");
    return { companyId, userId, source, crmScope: null };
  }
  if (!(await PermissionService.can(userId, "crm", "view"))) throw new BusinessRuleError("PERMISSION_DENIED", "Segments of CRM records need access to the CRM.");
  return { companyId, userId, source, crmScope: await getCrmRecordScope({ companyId, userId, branchId: null }) };
}

/** Records that exist and can be part of a segment at all (no user scope). */
export function availabilityWhere(source: SegmentSourceKey, companyId: string): W {
  switch (source) {
    case "CONTACT":
    case "COMPANY":
      return { companyId, archivedAt: null, mergedIntoId: null };
    case "LEAD":
      return { companyId, archivedAt: null };
    case "CUSTOMER":
      return { companyId, deletedAt: null, isActive: true };
  }
}

/** Available AND visible to the running user. */
export function baseWhere(access: SegmentAccess): W {
  const avail = availabilityWhere(access.source, access.companyId);
  if (!access.crmScope) return avail;
  const scope = crmOwnerWhere(access.crmScope);
  return Object.keys(scope).length ? { AND: [avail, scope] } : avail;
}

// ── Field → column mapping (allow-list) ─────────────────────────────

type ColumnKind = "text" | "number" | "instant" | "id" | "enum";
interface Column {
  path: string[];
  kind: ColumnKind;
}
const col = (kind: ColumnKind, ...path: string[]): Column => ({ path, kind });

const FIELD_COLUMNS: Record<SegmentSourceKey, Record<string, Column>> = {
  CONTACT: {
    fullName: col("text", "fullName"),
    email: col("text", "email"),
    mobile: col("text", "mobile"),
    designation: col("text", "designation"),
    department: col("text", "department"),
    "company.name": col("text", "crmCompany", "name"),
    "company.country": col("text", "crmCompany", "country"),
    "company.state": col("text", "crmCompany", "state"),
    "company.city": col("text", "crmCompany", "city"),
    "company.industry": col("text", "crmCompany", "industry"),
    ownerUserId: col("id", "ownerUserId"),
    sourceId: col("id", "sourceId"),
    createdAt: col("instant", "createdAt"),
    lastActivityAt: col("instant", "lastActivityAt"),
  },
  COMPANY: {
    name: col("text", "name"),
    companyType: col("text", "companyType"),
    industry: col("text", "industry"),
    country: col("text", "country"),
    state: col("text", "state"),
    city: col("text", "city"),
    email: col("text", "email"),
    statusId: col("id", "statusId"),
    ownerUserId: col("id", "ownerUserId"),
    sourceId: col("id", "sourceId"),
    createdAt: col("instant", "createdAt"),
    lastActivityAt: col("instant", "lastActivityAt"),
  },
  LEAD: {
    fullName: col("text", "fullName"),
    companyName: col("text", "companyName"),
    email: col("text", "email"),
    industry: col("text", "industry"),
    country: col("text", "country"),
    state: col("text", "state"),
    city: col("text", "city"),
    statusId: col("id", "statusId"),
    sourceId: col("id", "sourceId"),
    ownerUserId: col("id", "ownerUserId"),
    campaignId: col("id", "campaignId"),
    temperature: col("enum", "temperature"),
    captureChannel: col("enum", "captureChannel"),
    score: col("number", "score"),
    estimatedValue: col("number", "estimatedValue"),
    createdAt: col("instant", "createdAt"),
    lastContactedAt: col("instant", "lastContactedAt"),
  },
  CUSTOMER: {
    name: col("text", "name"),
    code: col("text", "code"),
    type: col("text", "type"),
    country: col("text", "country"),
    city: col("text", "city"),
    email: col("text", "email"),
    salesTerritoryId: col("id", "salesTerritoryId"),
    createdAt: col("instant", "createdAt"),
  },
};

const RELATIONS = new Set(["crmCompany"]);

/** Wraps a leaf filter on the last path segment in its to-one relations. */
function nest(path: string[], leaf: unknown): W {
  const [head, ...rest] = path;
  if (!rest.length) return { [head]: leaf };
  if (!RELATIONS.has(head)) throw new Error(`Unsupported relation ${head}`);
  return { [head]: { is: nest(rest, leaf) } };
}
/** "No value": column null (or blank text), or the related record is missing. */
function emptyWhere(c: Column): W {
  const ors: W[] = [nest(c.path, null)];
  if (c.kind === "text") ors.push(nest(c.path, ""));
  if (c.path.length > 1) ors.push({ [c.path[0]]: { is: null } });
  return { OR: ors };
}
function notEmptyWhere(c: Column): W {
  const ands: W[] = [nest(c.path, { not: null })];
  if (c.kind === "text") ands.push(nest(c.path, { not: "" }));
  return { AND: ands };
}
/** Negative operators also match records with no value (see registry semantics). */
const negated = (c: Column, positive: W): W => ({ OR: [{ NOT: positive }, emptyWhere(c)] });

const insensitive = { mode: "insensitive" as const };
const today = () => businessToday();

function columnWhere(c: Column, cond: SegmentCondition): W {
  const v = cond.value;
  switch (cond.operator) {
    case "is_empty":
      return emptyWhere(c);
    case "is_not_empty":
      return notEmptyWhere(c);
  }
  if (c.kind === "text") {
    const s = v as string;
    switch (cond.operator) {
      case "equals":
        return nest(c.path, { equals: s, ...insensitive });
      case "not_equals":
        return negated(c, nest(c.path, { equals: s, ...insensitive }));
      case "contains":
        return nest(c.path, { contains: s, ...insensitive });
      case "not_contains":
        return negated(c, nest(c.path, { contains: s, ...insensitive }));
      case "starts_with":
        return nest(c.path, { startsWith: s, ...insensitive });
    }
  }
  if (c.kind === "number") {
    switch (cond.operator) {
      case "equals":
        return nest(c.path, { equals: v });
      case "not_equals":
        return negated(c, nest(c.path, { equals: v }));
      case "gt":
      case "gte":
      case "lt":
      case "lte":
        return nest(c.path, { [cond.operator]: v });
      case "between": {
        const [a, b] = v as [number, number];
        return nest(c.path, { gte: a, lte: b });
      }
    }
  }
  if (c.kind === "instant") {
    switch (cond.operator) {
      case "on":
        return nest(c.path, { gte: businessDayStart(v as string), lte: businessDayEnd(v as string) });
      case "before":
        return nest(c.path, { lt: businessDayStart(v as string) });
      case "after":
        return nest(c.path, { gt: businessDayEnd(v as string) });
      case "between": {
        const [a, b] = v as [string, string];
        return nest(c.path, { gte: businessDayStart(a), lte: businessDayEnd(b) });
      }
      case "in_last_days":
        return nest(c.path, { gte: businessDayStart(addCalendarDays(today(), -((v as number) - 1))) });
      case "not_in_last_days":
        return negated(c, nest(c.path, { gte: businessDayStart(addCalendarDays(today(), -((v as number) - 1))) }));
    }
  }
  if (c.kind === "id" || c.kind === "enum") {
    switch (cond.operator) {
      case "in":
        return nest(c.path, { in: v });
      case "not_in":
        return negated(c, nest(c.path, { in: v }));
    }
  }
  throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported comparison for ${cond.field}.`);
}

// ── Special (computed) fields ───────────────────────────────────────

const TAG_ENTITY: Partial<Record<SegmentSourceKey, "CONTACT" | "COMPANY" | "LEAD">> = { CONTACT: "CONTACT", COMPANY: "COMPANY", LEAD: "LEAD" };

function capIds(ids: string[], what: string) {
  if (ids.length > MAX_ID_SET) throw new BusinessRuleError("VALIDATION_ERROR", `The "${what}" condition matches too many records to evaluate safely. Narrow it with other conditions.`);
  return ids;
}

async function tagsWhere(db: Db, access: SegmentAccess, cond: SegmentCondition): Promise<W> {
  const entityType = TAG_ENTITY[access.source];
  if (!entityType) throw new BusinessRuleError("VALIDATION_ERROR", "Tags aren't available for this record type.");
  const tagIds = cond.value as string[];
  if (cond.operator === "has_all") {
    const rows = await db.crmEntityTag.groupBy({
      by: ["entityId"],
      where: { companyId: access.companyId, entityType, tagId: { in: tagIds } },
      having: { tagId: { _count: { equals: tagIds.length } } },
    });
    return { id: { in: capIds(rows.map((r) => r.entityId), "Tags") } };
  }
  const rows = await db.crmEntityTag.findMany({ where: { companyId: access.companyId, entityType, tagId: { in: tagIds } }, select: { entityId: true }, distinct: ["entityId"] });
  const ids = capIds(rows.map((r) => r.entityId), "Tags");
  return cond.operator === "has_none" ? { id: { notIn: ids } } : { id: { in: ids } };
}

const utcDay = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Customer "last booked order date" — booked Sales Orders only (Phase 05 rule). */
function lastOrderWhere(companyId: string, cond: SegmentCondition): W {
  const booked = (extra: Prisma.SalesOrderWhereInput = {}): Prisma.SalesOrderWhereInput => ({ AND: [{ companyId }, bookedOrderWhere, extra] });
  const some = (extra?: Prisma.SalesOrderWhereInput) => ({ salesOrders: { some: booked(extra) } });
  const none = (extra?: Prisma.SalesOrderWhereInput) => ({ salesOrders: { none: booked(extra) } });
  const v = cond.value;
  switch (cond.operator) {
    case "is_empty":
      return none();
    case "is_not_empty":
      return some();
    case "on":
      return { AND: [some({ orderDate: utcDay(v as string) }), none({ orderDate: { gt: utcDay(v as string) } })] };
    case "before":
      return { AND: [some(), none({ orderDate: { gte: utcDay(v as string) } })] };
    case "after":
      return some({ orderDate: { gt: utcDay(v as string) } });
    case "between": {
      const [a, b] = v as [string, string];
      return { AND: [some({ orderDate: { gte: utcDay(a), lte: utcDay(b) } }), none({ orderDate: { gt: utcDay(b) } })] };
    }
    case "in_last_days":
      return some({ orderDate: { gte: utcDay(addCalendarDays(today(), -((v as number) - 1))) } });
    case "not_in_last_days":
      return none({ orderDate: { gte: utcDay(addCalendarDays(today(), -((v as number) - 1))) } });
  }
  throw new BusinessRuleError("VALIDATION_ERROR", "Unsupported comparison for the last order date.");
}

/** Total booked value / number of booked orders per customer (company currency), as a set of matching ids. */
async function bookedAggregateWhere(db: Db, companyId: string, cond: SegmentCondition, measure: "value" | "count"): Promise<W> {
  const agg = measure === "value" ? Prisma.sql`COALESCE(SUM(so.base_total_amount), 0)` : Prisma.sql`COUNT(so.id)`;
  const v = cond.value;
  let having: Prisma.Sql;
  switch (cond.operator) {
    case "equals":
      having = Prisma.sql`${agg} = ${v as number}`;
      break;
    case "gt":
      having = Prisma.sql`${agg} > ${v as number}`;
      break;
    case "gte":
      having = Prisma.sql`${agg} >= ${v as number}`;
      break;
    case "lt":
      having = Prisma.sql`${agg} < ${v as number}`;
      break;
    case "lte":
      having = Prisma.sql`${agg} <= ${v as number}`;
      break;
    case "between": {
      const [a, b] = v as [number, number];
      having = Prisma.sql`${agg} BETWEEN ${a} AND ${b}`;
      break;
    }
    default:
      throw new BusinessRuleError("VALIDATION_ERROR", "Unsupported comparison for booked orders.");
  }
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT c.id::text AS id
    FROM customers c
    LEFT JOIN sales_orders so ON so.customer_id = c.id AND so.company_id = c.company_id AND ${bookedOrderSql("so")}
    WHERE c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
    GROUP BY c.id
    HAVING ${having}
    LIMIT ${MAX_ID_SET + 1}`);
  return { id: { in: capIds(rows.map((r) => r.id), measure === "value" ? "Total booked order value" : "Number of booked orders") } };
}

async function conditionWhere(db: Db, access: SegmentAccess, cond: SegmentCondition): Promise<W> {
  const field = fieldDef(access.source, cond.field);
  if (!field) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown field "${cond.field}".`);
  if (field.type === "tags") return tagsWhere(db, access, cond);
  switch (`${access.source}:${cond.field}`) {
    case "CONTACT:company.isErpCustomer":
      return cond.operator === "is_true" ? { crmCompany: { is: { customerId: { not: null } } } } : { OR: [{ crmCompany: { is: null } }, { crmCompany: { is: { customerId: null } } }] };
    case "COMPANY:isErpCustomer":
      return cond.operator === "is_true" ? { customerId: { not: null } } : { customerId: null };
    case "LEAD:converted":
      return cond.operator === "is_true" ? { convertedAt: { not: null } } : { convertedAt: null };
    case "CUSTOMER:lastOrderDate":
      return lastOrderWhere(access.companyId, cond);
    case "CUSTOMER:bookedOrderValue":
      return bookedAggregateWhere(db, access.companyId, cond, "value");
    case "CUSTOMER:bookedOrderCount":
      return bookedAggregateWhere(db, access.companyId, cond, "count");
  }
  const c = FIELD_COLUMNS[access.source][cond.field];
  if (!c) throw new BusinessRuleError("VALIDATION_ERROR", `"${field.label}" can't be used here.`);
  if (OPERATORS[cond.operator] === undefined) throw new BusinessRuleError("VALIDATION_ERROR", "Unsupported comparison.");
  return columnWhere(c, cond);
}

/**
 * Criteria → where. Re-validates (the server never trusts a stored or posted
 * definition) and throws on any problem. Zero groups = every record (`{}`).
 */
export async function criteriaWhere(db: Db, access: SegmentAccess, raw: unknown): Promise<W> {
  const { criteria, issues } = validateCriteria(access.source, raw);
  if (issues.length) throw new BusinessRuleError("VALIDATION_ERROR", issues[0].message, { issues });
  return compileValidCriteria(db, access, criteria);
}

async function compileValidCriteria(db: Db, access: SegmentAccess, criteria: SegmentCriteria): Promise<W> {
  if (!criteria.groups.length) return {};
  const groups: W[] = [];
  for (const g of criteria.groups) {
    const conds: W[] = [];
    for (const c of g.conditions) conds.push(await conditionWhere(db, access, c));
    groups.push(g.match === "ALL" ? { AND: conds } : { OR: conds });
  }
  return criteria.match === "ALL" ? { AND: groups } : { OR: groups };
}

/** Exclusion rules: null / zero groups = nothing excluded (returns null). */
export async function exclusionWhere(db: Db, access: SegmentAccess, raw: unknown): Promise<W | null> {
  if (!raw || !(raw as SegmentCriteria).groups?.length) return null;
  return criteriaWhere(db, access, raw);
}

// ── Eligibility (address + consent) ─────────────────────────────────

const ADDRESS_COLUMNS: Record<SegmentSourceKey, Record<EligibilityChannelKey, string[]>> = {
  CONTACT: { EMAIL: ["email"], WHATSAPP: ["whatsapp", "mobile"], SMS: ["mobile"], PHONE: ["phone", "mobile"] },
  LEAD: { EMAIL: ["email"], WHATSAPP: ["whatsapp", "mobile"], SMS: ["mobile"], PHONE: ["phone", "mobile"] },
  COMPANY: { EMAIL: ["email"], WHATSAPP: ["mobile"], SMS: ["mobile"], PHONE: ["phone", "mobile"] },
  CUSTOMER: { EMAIL: ["email"], WHATSAPP: ["phone"], SMS: ["phone"], PHONE: ["phone"] },
};

export function hasAddressWhere(source: SegmentSourceKey, channel: EligibilityChannelKey): W {
  return { OR: ADDRESS_COLUMNS[source][channel].map((c) => ({ AND: [{ [c]: { not: null } }, { [c]: { not: "" } }] })) };
}

/** Contacts only: an opt-out / DNC / bounce on this channel or on "all channels" (Phase 04 consents). */
export function consentRestrictedWhere(source: SegmentSourceKey, channel: EligibilityChannelKey): W | null {
  if (source !== "CONTACT") return null;
  return { consents: { some: { channel: { in: [channel, "ALL"] }, status: { not: "ALLOWED" } } } };
}

/** What a snapshot / preview can honestly say about consent for this source + channel. */
export function consentCheck(source: SegmentSourceKey, channel: EligibilityChannelKey | null): "VERIFIED" | "NOT_AVAILABLE" | "NOT_CHECKED" {
  if (!channel) return "NOT_CHECKED";
  return source === "CONTACT" ? "VERIFIED" : "NOT_AVAILABLE";
}

// ── Source delegates and classification ─────────────────────────────

interface Delegate {
  count(args: { where: W }): Promise<number>;
  findMany(args: { where: W; select: Record<string, unknown>; orderBy?: unknown; take?: number; skip?: number; cursor?: { id: string } }): Promise<{ id: string }[]>;
}
export function delegate(db: Db, source: SegmentSourceKey): Delegate {
  switch (source) {
    case "CONTACT":
      return db.crmContact as unknown as Delegate;
    case "COMPANY":
      return db.crmCompany as unknown as Delegate;
    case "LEAD":
      return db.crmLead as unknown as Delegate;
    case "CUSTOMER":
      return db.customer as unknown as Delegate;
  }
}

export interface CompiledDefinition {
  access: SegmentAccess;
  segmentType: "DYNAMIC" | "STATIC";
  criteria: W;
  exclusion: W | null;
  manualExclusionIds: string[];
  channel: EligibilityChannelKey | null;
}

export interface Classified {
  recordId: string;
  outcome: "INCLUDED" | "EXCLUDED" | "INELIGIBLE";
  origin: "CRITERIA" | "STATIC";
  reason: EntryReasonKey | null;
}

const idSet = async (db: Db, def: CompiledDefinition, where: W, ids: string[]) =>
  new Set((await delegate(db, def.access.source).findMany({ where: { AND: [where, { id: { in: ids } }] }, select: { id: true } })).map((r) => r.id));

/**
 * Classifies one batch of candidate ids (≤ 1000). For STATIC candidates it
 * first checks the record still exists / is visible; then manual exclusions,
 * exclusion rules, missing address and consent — in that order, so each
 * record gets exactly one outcome and one reason.
 */
export async function classifyBatch(db: Db, def: CompiledDefinition, ids: string[], origin: "CRITERIA" | "STATIC"): Promise<Classified[]> {
  if (!ids.length) return [];
  const out = new Map<string, Classified>();
  let remaining = ids;
  if (origin === "STATIC") {
    const available = await idSet(db, def, availabilityWhere(def.access.source, def.access.companyId), remaining);
    const visible = await idSet(db, def, baseWhere(def.access), remaining);
    for (const id of remaining) {
      if (!available.has(id)) out.set(id, { recordId: id, outcome: "EXCLUDED", origin, reason: "SOURCE_UNAVAILABLE" });
      else if (!visible.has(id)) out.set(id, { recordId: id, outcome: "EXCLUDED", origin, reason: "NOT_ACCESSIBLE" });
    }
    remaining = remaining.filter((id) => !out.has(id));
  }
  const manual = new Set(def.manualExclusionIds);
  for (const id of remaining) if (manual.has(id)) out.set(id, { recordId: id, outcome: "EXCLUDED", origin, reason: "MANUAL_EXCLUSION" });
  remaining = remaining.filter((id) => !out.has(id));
  if (def.exclusion && remaining.length) {
    const hit = await idSet(db, def, { AND: [baseWhere(def.access), def.exclusion] }, remaining);
    for (const id of hit) out.set(id, { recordId: id, outcome: "EXCLUDED", origin, reason: "EXCLUSION_RULE" });
    remaining = remaining.filter((id) => !out.has(id));
  }
  if (def.channel && remaining.length) {
    const withAddress = await idSet(db, def, hasAddressWhere(def.access.source, def.channel), remaining);
    for (const id of remaining) if (!withAddress.has(id)) out.set(id, { recordId: id, outcome: "INELIGIBLE", origin, reason: "NO_ADDRESS" });
    remaining = remaining.filter((id) => !out.has(id));
    const consent = consentRestrictedWhere(def.access.source, def.channel);
    if (consent && remaining.length) {
      const restricted = await idSet(db, def, consent, remaining);
      for (const id of restricted) out.set(id, { recordId: id, outcome: "INELIGIBLE", origin, reason: "CONSENT_RESTRICTED" });
      remaining = remaining.filter((id) => !out.has(id));
    }
  }
  for (const id of remaining) out.set(id, { recordId: id, outcome: "INCLUDED", origin, reason: null });
  return ids.map((id) => out.get(id)!);
}

/** Where for a DYNAMIC segment's final members (criteria, minus exclusions, eligible). */
export function dynamicWheres(def: CompiledDefinition) {
  const matched: W = { AND: [baseWhere(def.access), def.criteria] };
  const excludedParts: W[] = [];
  if (def.manualExclusionIds.length) excludedParts.push({ id: { in: def.manualExclusionIds } });
  if (def.exclusion) excludedParts.push(def.exclusion);
  const excluded: W | null = excludedParts.length ? { OR: excludedParts } : null;
  const ineligibleParts: W[] = [];
  if (def.channel) {
    ineligibleParts.push({ NOT: hasAddressWhere(def.access.source, def.channel) });
    const consent = consentRestrictedWhere(def.access.source, def.channel);
    if (consent) ineligibleParts.push(consent);
  }
  const ineligible: W | null = ineligibleParts.length ? { OR: ineligibleParts } : null;
  const notExcluded = excluded ? [{ NOT: excluded }] : [];
  const members: W = { AND: [matched, ...notExcluded, ...(ineligible ? [{ NOT: ineligible }] : [])] };
  return {
    matched,
    excluded: excluded ? { AND: [matched, excluded] } : null,
    ineligible: ineligible ? { AND: [matched, ...notExcluded, ineligible] } : null,
    members,
  };
}

/**
 * Runs `fn` with a statement timeout, so a costly preview fails cleanly
 * instead of tying up the database. Evaluations (background) use a longer one.
 */
export async function withStatementTimeout<T>(ms: number, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(ms))}`);
        return fn(tx);
      },
      { timeout: ms + 5000, maxWait: 10_000 }
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (/statement timeout|canceling statement/i.test(msg)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "This audience is too expensive to count live. Narrow the rules, or refresh the segment to evaluate it in the background.");
    }
    throw e;
  }
}

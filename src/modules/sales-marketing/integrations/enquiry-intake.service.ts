import { Prisma } from "@prisma/client";
import { z } from "zod";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { optionalPhoneSchema } from "@/lib/validation";
import { assertSalesEnquiryVisible, createSalesEnquiry, updateSalesEnquiryDetails, type SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { SALES_ENQUIRY_PRIORITY_KEYS } from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";
import { CONFLICT_REASONS, INTAKE_CREATE_ONLY_FIELDS, INTAKE_OPEN_STAGES, INTAKE_SYSTEM_RE, INTAKE_UPDATABLE_FIELDS } from "./integration-registry";
import { ensureRegistryRow, RESOURCE_TYPE } from "./integration-registry.service";

/**
 * Phase 16 — enquiry intake from external systems (website, marketplace,
 * partner portal). Ownership rules:
 *
 *  - The external system creates an enquiry once per (system, externalId):
 *    the mapping is claimed first, so concurrent or repeated submissions never
 *    create a second enquiry. The ERP id is canonical; the external id is a
 *    reference.
 *  - After creation the ERP owns the enquiry. An external change is applied
 *    only to an intake field (subject, remarks, priority), only while the
 *    enquiry is still at intake (NEW / UNDER_REVIEW), and only if nobody
 *    changed that field in the ERP since the last sync — through the enquiry
 *    service, as the key's user. Anything else becomes an OPEN conflict for a
 *    person; nothing is silently overwritten.
 *  - Ordering: `sourceUpdatedAt` older than what was last applied is ignored
 *    (STALE_IGNORED), so late or replayed deliveries can't undo newer data.
 *    Equal timestamps with identical values are UNCHANGED.
 */

const EXTERNAL_TYPE = "ENQUIRY";
const PENDING_ENTITY = "00000000-0000-0000-0000-000000000000";
const text = (max: number) => z.string().trim().max(max).optional().nullable();

export const intakeSchema = z
  .object({
    system: z.string().trim().regex(INTAKE_SYSTEM_RE, "Use 1–40 lowercase letters, digits, dot, dash or underscore."),
    externalId: z.string().trim().min(1).max(120),
    sourceUpdatedAt: z.string().datetime({ offset: true }).optional(),
    enquiry: z
      .object({
        subject: text(200),
        remarks: text(2000),
        priority: z.enum(SALES_ENQUIRY_PRIORITY_KEYS).optional(),
        source: z.enum(["EMAIL", "PHONE", "TRADE_SHOW", "REFERRAL", "WEBSITE", "OTHER"]).optional(),
        enquiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        customerId: z.string().uuid().optional().nullable(),
        prospect: z
          .object({
            name: z.string().trim().min(1).max(200),
            contactPerson: text(200),
            email: z.string().trim().email().max(200).optional().nullable(),
            phone: optionalPhoneSchema.nullable(),
            country: text(100),
          })
          .strict()
          .optional()
          .nullable(),
        lines: z
          .array(
            z
              .object({
                styleId: z.string().uuid().optional().nullable(),
                styleName: text(200),
                description: text(2000),
                colorRemarks: text(200),
                quantity: z.number().positive().max(100_000_000).optional().nullable(),
                targetUnitPrice: z.number().min(0).max(100_000_000).optional().nullable(),
                targetDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
              })
              .strict()
          )
          .min(1)
          .max(50),
      })
      .strict(),
  })
  .strict();
export type IntakeInput = z.infer<typeof intakeSchema>;

type Snapshot = Record<string, string | null>;
const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : typeof v === "string" ? v.trim() || null : String(v));

/** The comparable external values (what the external system says now). */
export function snapshotOf(e: IntakeInput["enquiry"]): Snapshot {
  return {
    subject: norm(e.subject),
    remarks: norm(e.remarks),
    priority: norm(e.priority ?? "NORMAL"),
    prospectName: norm(e.prospect?.name),
    prospectContactPerson: norm(e.prospect?.contactPerson),
    prospectEmail: norm(e.prospect?.email),
    prospectPhone: norm(e.prospect?.phone),
    prospectCountry: norm(e.prospect?.country),
    lines: JSON.stringify(e.lines.map((l) => [l.styleId ?? null, norm(l.styleName), norm(l.description), norm(l.colorRemarks), l.quantity ?? null, l.targetUnitPrice ?? null, l.targetDeliveryDate ?? null])),
  };
}

export type FieldDecision = { field: string; action: "apply" | "unchanged" } | { field: string; action: "conflict"; reason: keyof typeof CONFLICT_REASONS };

/**
 * Pure field-ownership decision for one external update. `last` = what the
 * external system sent last time (the baseline); `erp` = the ERP's current
 * values; `incoming` = this update.
 */
export function decideFields(incoming: Snapshot, last: Snapshot, erp: Snapshot, stage: string): FieldDecision[] {
  const out: FieldDecision[] = [];
  for (const field of [...INTAKE_UPDATABLE_FIELDS, ...INTAKE_CREATE_ONLY_FIELDS]) {
    const now = incoming[field] ?? null;
    const before = last[field] ?? null;
    if (now === before) {
      out.push({ field, action: "unchanged" });
      continue;
    }
    if ((INTAKE_CREATE_ONLY_FIELDS as readonly string[]).includes(field)) out.push({ field, action: "conflict", reason: "NOT_UPDATABLE" });
    else if (!(INTAKE_OPEN_STAGES as readonly string[]).includes(stage)) out.push({ field, action: "conflict", reason: "RECORD_ADVANCED" });
    else if ((erp[field] ?? null) !== before) out.push({ field, action: "conflict", reason: "ERP_CHANGED" });
    else out.push({ field, action: "apply" });
  }
  return out;
}

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function createPayload(e: IntakeInput["enquiry"]) {
  return {
    customerId: e.customerId ?? "",
    prospectName: e.prospect?.name ?? "",
    prospectContactPerson: e.prospect?.contactPerson ?? "",
    prospectEmail: e.prospect?.email ?? "",
    prospectPhone: e.prospect?.phone ?? "",
    prospectCountry: e.prospect?.country ?? "",
    enquiryDate: e.enquiryDate ?? todayIst(),
    source: e.source ?? "WEBSITE",
    remarks: e.remarks ?? "",
    subject: e.subject ?? "",
    priority: e.priority,
    lines: e.lines.map((l) => ({
      productId: l.styleId ?? "",
      styleNameFreeText: l.styleName ?? "",
      description: l.description ?? "",
      colorRemarks: l.colorRemarks ?? "",
      targetQuantity: l.quantity ?? undefined,
      targetUnitPrice: l.targetUnitPrice ?? undefined,
      targetDeliveryDate: l.targetDeliveryDate ?? "",
    })),
  };
}

async function erpSnapshot(companyId: string, enquiryId: string): Promise<{ snap: Snapshot; stage: string; number: string }> {
  const e = await prisma.buyerEnquiry.findFirstOrThrow({ where: { id: enquiryId, companyId }, select: { subject: true, remarks: true, priority: true, prospectName: true, prospectContactPerson: true, prospectEmail: true, prospectPhone: true, prospectCountry: true, salesStage: true, enquiryNumber: true } });
  return {
    snap: { subject: norm(e.subject), remarks: norm(e.remarks), priority: norm(e.priority), prospectName: norm(e.prospectName), prospectContactPerson: norm(e.prospectContactPerson), prospectEmail: norm(e.prospectEmail), prospectPhone: norm(e.prospectPhone), prospectCountry: norm(e.prospectCountry), lines: null },
    stage: e.salesStage,
    number: e.enquiryNumber,
  };
}

async function registryIdForKey(companyId: string, keyId: string) {
  await ensureRegistryRow(companyId, "API_CLIENT", keyId);
  const row = await prisma.integration.findUnique({ where: { companyId_resourceType_resourceId: { companyId, resourceType: RESOURCE_TYPE.API_CLIENT, resourceId: keyId } }, select: { id: true } });
  return row!.id;
}

async function bumpCheckpoint(companyId: string, integrationId: string, stream: string, field: "created" | "updated" | "unchanged" | "staleIgnored" | "conflicts" | "failed", sourceAt: Date | null, error?: string) {
  const now = new Date();
  await prisma.integrationSyncCheckpoint.upsert({
    where: { integrationId_stream: { integrationId, stream } },
    create: { companyId, integrationId, stream, lastRunAt: now, lastSourceAt: sourceAt, [field]: 1, lastError: error ?? null },
    update: { lastRunAt: now, [field]: { increment: 1 }, ...(error ? { lastError: error.slice(0, 300) } : {}) },
  });
  if (sourceAt) await prisma.integrationSyncCheckpoint.updateMany({ where: { integrationId, stream, OR: [{ lastSourceAt: null }, { lastSourceAt: { lt: sourceAt } }] }, data: { lastSourceAt: sourceAt } });
}

export interface IntakeResult {
  enquiryId: string;
  enquiryNumber: string;
  result: "CREATED" | "UPDATED" | "UNCHANGED" | "STALE_IGNORED";
  applied: string[];
  conflicts: { field: string; reason: string; message: string }[];
}

/** POST /enquiries — create or update one enquiry from an external system, as the key's user. */
export async function submitEnquiry(actor: SalesActor, key: { keyId: string }, raw: unknown): Promise<IntakeResult> {
  const input = intakeSchema.parse(raw);
  if (!input.enquiry.customerId && !input.enquiry.prospect) throw new BusinessRuleError("VALIDATION_ERROR", "Send enquiry.customerId (an existing customer) or enquiry.prospect.", { fieldErrors: { "enquiry.prospect": "Required without customerId." } });
  const sourceAt = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : new Date();
  if (sourceAt.getTime() > Date.now() + 5 * 60_000) throw new BusinessRuleError("VALIDATION_ERROR", "sourceUpdatedAt is in the future.");
  const integrationId = await registryIdForKey(actor.companyId, key.keyId);
  const stream = `enquiries:${input.system}`;
  const incoming = snapshotOf(input.enquiry);
  const where = { companyId_system_externalType_externalId: { companyId: actor.companyId, system: input.system, externalType: EXTERNAL_TYPE, externalId: input.externalId } };

  let ref = await prisma.integrationExternalRef.findUnique({ where });
  if (!ref) {
    // Claim the mapping before creating anything: a concurrent or repeated submission sees the claim.
    try {
      ref = await prisma.integrationExternalRef.create({ data: { companyId: actor.companyId, integrationId, system: input.system, externalType: EXTERNAL_TYPE, externalId: input.externalId, entityType: "ENQUIRY", entityId: PENDING_ENTITY, sourceUpdatedAt: sourceAt, lastValues: incoming } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new BusinessRuleError("REQUEST_IN_PROGRESS", "This externalId is being processed by another request. Retry shortly.");
      throw e;
    }
    try {
      const created = await createSalesEnquiry(actor, createPayload(input.enquiry));
      await prisma.integrationExternalRef.update({ where: { id: ref.id }, data: { entityId: created.id } });
      await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "integration_external_refs", recordId: ref.id, action: "CREATE", newValues: { system: input.system, externalId: input.externalId, enquiryId: created.id, via: "API" } });
      await bumpCheckpoint(actor.companyId, integrationId, stream, "created", sourceAt);
      return { enquiryId: created.id, enquiryNumber: created.enquiryNumber, result: "CREATED", applied: [], conflicts: [] };
    } catch (e) {
      await prisma.integrationExternalRef.delete({ where: { id: ref.id } }).catch(() => undefined);
      await bumpCheckpoint(actor.companyId, integrationId, stream, "failed", null, e instanceof BusinessRuleError ? e.message : "Unexpected error.");
      throw e;
    }
  }
  if (ref.entityId === PENDING_ENTITY) throw new BusinessRuleError("REQUEST_IN_PROGRESS", "This externalId is being processed by another request. Retry shortly.");

  const erp = await erpSnapshot(actor.companyId, ref.entityId);
  const last = (ref.lastValues ?? {}) as Snapshot;
  if (ref.sourceUpdatedAt && sourceAt < ref.sourceUpdatedAt) {
    await bumpCheckpoint(actor.companyId, integrationId, stream, "staleIgnored", null);
    return { enquiryId: ref.entityId, enquiryNumber: erp.number, result: "STALE_IGNORED", applied: [], conflicts: [] };
  }
  const decisions = decideFields(incoming, last, erp.snap, erp.stage);
  const apply = decisions.filter((d) => d.action === "apply").map((d) => d.field);
  const conflicts = decisions.filter((d): d is Extract<FieldDecision, { action: "conflict" }> => d.action === "conflict");

  if (apply.length) {
    const patch: Record<string, unknown> = {};
    for (const f of apply) patch[f] = f === "priority" ? (incoming.priority ?? "NORMAL") : (incoming[f] ?? "");
    await updateSalesEnquiryDetails(actor, ref.entityId, patch);
  }
  for (const c of conflicts) {
    const open = await prisma.integrationConflict.findFirst({ where: { externalRefId: ref.id, field: c.field, status: "OPEN" }, select: { id: true } });
    const values = { reason: c.reason, erpValue: c.field === "lines" ? "(the enquiry lines in the ERP)" : (erp.snap[c.field] ?? null), externalValue: c.field === "lines" ? JSON.parse(incoming.lines ?? "[]") : (incoming[c.field] ?? null), sourceUpdatedAt: sourceAt };
    if (open) await prisma.integrationConflict.update({ where: { id: open.id }, data: values as Prisma.IntegrationConflictUpdateInput });
    else await prisma.integrationConflict.create({ data: { companyId: actor.companyId, integrationId, externalRefId: ref.id, entityType: "ENQUIRY", entityId: ref.entityId, field: c.field, ...(values as object) } as Prisma.IntegrationConflictUncheckedCreateInput });
  }
  // The baseline becomes what the external system says now (conflicting values included: they are recorded, not lost).
  await prisma.integrationExternalRef.update({ where: { id: ref.id }, data: { lastValues: incoming, sourceUpdatedAt: sourceAt } });
  const result = apply.length ? "UPDATED" : "UNCHANGED";
  await bumpCheckpoint(actor.companyId, integrationId, stream, conflicts.length ? "conflicts" : result === "UPDATED" ? "updated" : "unchanged", sourceAt);
  return { enquiryId: ref.entityId, enquiryNumber: erp.number, result, applied: apply, conflicts: conflicts.map((c) => ({ field: c.field, reason: c.reason, message: CONFLICT_REASONS[c.reason] })) };
}

/** GET /enquiries/{system}/{externalId} — the mapping, the enquiry's stage and open conflicts. */
export async function getIntakeStatus(actor: SalesActor, system: string, externalId: string) {
  if (!INTAKE_SYSTEM_RE.test(system) || !externalId || externalId.length > 120) throw new BusinessRuleError("NOT_FOUND", "Not found.");
  const ref = await prisma.integrationExternalRef.findUnique({ where: { companyId_system_externalType_externalId: { companyId: actor.companyId, system, externalType: EXTERNAL_TYPE, externalId } }, include: { conflicts: { where: { status: "OPEN" }, select: { field: true, reason: true } } } });
  if (!ref || ref.entityId === PENDING_ENTITY) throw new BusinessRuleError("NOT_FOUND", "No enquiry for this externalId.");
  await assertSalesEnquiryVisible(actor, ref.entityId);
  const e = await prisma.buyerEnquiry.findFirstOrThrow({ where: { id: ref.entityId, companyId: actor.companyId }, select: { id: true, enquiryNumber: true, salesStage: true, updatedAt: true } });
  return {
    enquiryId: e.id,
    enquiryNumber: e.enquiryNumber,
    stage: e.salesStage,
    updatedAt: e.updatedAt.toISOString(),
    system: ref.system,
    externalId: ref.externalId,
    lastSourceUpdatedAt: ref.sourceUpdatedAt?.toISOString() ?? null,
    openConflicts: ref.conflicts.map((c) => ({ field: c.field, reason: c.reason, message: CONFLICT_REASONS[c.reason as keyof typeof CONFLICT_REASONS] })),
  };
}

// ── Conflicts (S&M → Integrations) ───────────────────────────────

export async function listConflicts(actor: SalesActor, q: { status?: string; skip: number; take: number }) {
  await PermissionService.assert(actor.userId, "sales_integrations", "view");
  const status = q.status && ["OPEN", "KEPT_ERP", "APPLIED_EXTERNAL", "DISMISSED"].includes(q.status) ? q.status : undefined;
  const where: Prisma.IntegrationConflictWhereInput = { companyId: actor.companyId, ...(status ? { status } : {}) };
  const [rows, totalCount] = await Promise.all([
    prisma.integrationConflict.findMany({ where, orderBy: [{ detectedAt: "desc" }], skip: q.skip, take: q.take, include: { externalRef: { select: { system: true, externalId: true } } } }),
    prisma.integrationConflict.count({ where }),
  ]);
  const enquiries = await prisma.buyerEnquiry.findMany({ where: { companyId: actor.companyId, id: { in: [...new Set(rows.map((r) => r.entityId))] } }, select: { id: true, enquiryNumber: true } });
  const num = new Map(enquiries.map((e) => [e.id, e.enquiryNumber]));
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.resolvedByUserId).filter((x): x is string => Boolean(x)) } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    totalCount,
    rows: rows.map((r) => ({
      id: r.id,
      status: r.status,
      field: r.field,
      reason: r.reason,
      reasonLabel: CONFLICT_REASONS[r.reason as keyof typeof CONFLICT_REASONS] ?? r.reason,
      erpValue: r.erpValue,
      externalValue: r.externalValue,
      canApply: (INTAKE_UPDATABLE_FIELDS as readonly string[]).includes(r.field),
      record: { type: r.entityType, id: r.entityId, number: num.get(r.entityId) ?? null, href: `/sales-marketing/enquiries/${r.entityId}` },
      external: { system: r.externalRef.system, id: r.externalRef.externalId },
      sourceUpdatedAt: r.sourceUpdatedAt,
      detectedAt: r.detectedAt,
      resolvedAt: r.resolvedAt,
      resolvedBy: r.resolvedByUserId ? (names.get(r.resolvedByUserId) ?? null) : null,
      resolutionNote: r.resolutionNote,
    })),
  };
}

const resolveSchema = z.object({ action: z.enum(["keep_erp", "apply_external", "dismiss"]), note: z.string().trim().max(500).optional().or(z.literal("")) }).strict();

/**
 * A person settles a conflict (sales_integrations.approve). "Apply external"
 * goes through the enquiry service as that person (their permission, record
 * visibility and the enquiry's own rules) — only for intake fields.
 */
export async function resolveConflict(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_integrations", "approve");
  const input = resolveSchema.parse(raw ?? {});
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BusinessRuleError("NOT_FOUND", "Conflict not found.");
  const c = await prisma.integrationConflict.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) throw new BusinessRuleError("NOT_FOUND", "Conflict not found.");
  if (c.status !== "OPEN") throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This conflict is already settled.");
  if (input.action === "apply_external") {
    if (!(INTAKE_UPDATABLE_FIELDS as readonly string[]).includes(c.field)) throw new BusinessRuleError("VALIDATION_ERROR", "This field can't be updated from outside — change it on the enquiry itself if needed, then keep the ERP value.");
    const v = c.externalValue as string | null;
    await updateSalesEnquiryDetails(actor, c.entityId, { [c.field]: c.field === "priority" ? (v ?? "NORMAL") : (v ?? "") });
  }
  const status = input.action === "apply_external" ? "APPLIED_EXTERNAL" : input.action === "keep_erp" ? "KEPT_ERP" : "DISMISSED";
  const r = await prisma.integrationConflict.updateMany({ where: { id, status: "OPEN" }, data: { status, resolutionNote: input.note || null, resolvedByUserId: actor.userId, resolvedAt: new Date() } });
  if (!r.count) throw new BusinessRuleError("RECORD_VERSION_CONFLICT", "Someone settled this conflict just now.");
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "integration_conflicts", recordId: id, action: "UPDATE", oldValues: { status: "OPEN" }, newValues: { status, field: c.field, note: input.note || null } });
  return { id, status };
}

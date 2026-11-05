import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { optionalText } from "@/modules/sales-marketing/performance/performance-common";
import { DEFAULT_LOOKUPS, type LookupKindKey } from "./campaign-registry";

/**
 * Campaign types and objectives (Phase 08): per-company lists. The defaults in
 * campaign-registry are added the first time a company's lists are read;
 * after that they are the company's own (rename, add, deactivate — never
 * deleted, campaigns keep pointing at them).
 */

const TABLE = "marketing_campaign_lookups";
const kindSchema = z.enum(["TYPE", "OBJECTIVE"]);
export const lookupCreateSchema = z
  .object({
    kind: kindSchema,
    code: z.string().trim().min(1, "Enter a code").max(40).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
    name: z.string().trim().min(1, "Enter a name").max(120),
    description: optionalText(500),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  })
  .strict();
export const lookupUpdateSchema = lookupCreateSchema.omit({ kind: true, code: true }).extend({ isActive: z.boolean().optional() }).strict();

export async function ensureCampaignLookups(companyId: string) {
  const count = await prisma.marketingCampaignLookup.groupBy({ by: ["kind"], where: { companyId }, _count: true });
  for (const kind of ["TYPE", "OBJECTIVE"] as const) {
    if (count.some((c) => c.kind === kind)) continue;
    await prisma.marketingCampaignLookup.createMany({
      data: DEFAULT_LOOKUPS[kind].map((d, i) => ({ companyId, kind, code: d.code, name: d.name, sortOrder: (i + 1) * 10 })),
      skipDuplicates: true,
    });
  }
}

export async function listCampaignLookups(actor: SalesActor, raw: unknown) {
  const f = z.object({ kind: kindSchema.optional().or(z.literal("")), includeInactive: z.enum(["true", "false"]).optional() }).parse(raw ?? {});
  await ensureCampaignLookups(actor.companyId);
  const rows = await prisma.marketingCampaignLookup.findMany({
    where: { companyId: actor.companyId, ...(f.kind ? { kind: f.kind } : {}), ...(f.includeInactive === "true" ? {} : { isActive: true }) },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { campaignsByType: true, campaignsByObjective: true } } },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind as LookupKindKey, code: r.code, name: r.name, description: r.description, sortOrder: r.sortOrder, active: r.isActive, campaigns: r._count.campaignsByType + r._count.campaignsByObjective }));
}

export async function createCampaignLookup(actor: SalesActor, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = lookupCreateSchema.parse(raw);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.marketingCampaignLookup.create({ data: { companyId: actor.companyId, kind: input.kind, code: input.code.toUpperCase(), name: input.name, description: input.description || null, sortOrder: input.sortOrder ?? 100 } });
      await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: r.id, action: "CREATE", newValues: { kind: r.kind, code: r.code, name: r.name } }, tx);
      return r;
    });
    return row;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new BusinessRuleError("VALIDATION_ERROR", "That code is already used in this list.", { fieldErrors: { code: "Already used." } });
    throw error;
  }
}

export async function updateCampaignLookup(actor: SalesActor, id: string, raw: unknown) {
  await PermissionService.assert(actor.userId, "sales_marketing_settings", "edit");
  const input = lookupUpdateSchema.parse(raw);
  const row = await prisma.marketingCampaignLookup.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw new BusinessRuleError("NOT_FOUND", "List value not found.", { id });
  const data = { name: input.name, description: input.description || null, ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  await prisma.$transaction(async (tx) => {
    await tx.marketingCampaignLookup.updateMany({ where: { id, companyId: actor.companyId }, data });
    await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: TABLE, recordId: id, action: "UPDATE", oldValues: { name: row.name, isActive: row.isActive }, newValues: data }, tx);
  });
  return prisma.marketingCampaignLookup.findUniqueOrThrow({ where: { id } });
}

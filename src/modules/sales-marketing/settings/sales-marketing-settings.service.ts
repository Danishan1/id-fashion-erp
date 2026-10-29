import { z } from "zod";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";

/**
 * Sales & Marketing settings (S3, 2026-10-28): quotation approval limits
 * (decision D2), default validity and default terms. One row per company;
 * reading never writes — a company without a row gets the defaults.
 */

export const SALES_MARKETING_SETTING_DEFAULTS = {
  quotationApprovalMaxDiscountPercent: 10,
  quotationApprovalMaxTotal: 500000,
  quotationDefaultValidityDays: 30,
  quotationDefaultTerms: null as string | null,
};

export type SalesMarketingSettingsView = typeof SALES_MARKETING_SETTING_DEFAULTS & { updatedAt: Date | null };

export async function getSalesMarketingSettings(companyId: string): Promise<SalesMarketingSettingsView> {
  const row = await prisma.salesMarketingSettings.findUnique({ where: { companyId } });
  if (!row) return { ...SALES_MARKETING_SETTING_DEFAULTS, updatedAt: null };
  return {
    quotationApprovalMaxDiscountPercent: Number(row.quotationApprovalMaxDiscountPercent),
    quotationApprovalMaxTotal: Number(row.quotationApprovalMaxTotal),
    quotationDefaultValidityDays: row.quotationDefaultValidityDays,
    quotationDefaultTerms: row.quotationDefaultTerms,
    updatedAt: row.updatedAt,
  };
}

export const salesMarketingSettingsSchema = z
  .object({
    quotationApprovalMaxDiscountPercent: z.coerce.number().min(0).max(100),
    quotationApprovalMaxTotal: z.coerce.number().min(0).max(9_999_999_999),
    quotationDefaultValidityDays: z.coerce.number().int().min(1).max(365),
    quotationDefaultTerms: z.string().trim().max(10000).optional().or(z.literal("")).nullable(),
  })
  .strict();

export async function updateSalesMarketingSettings(actor: { companyId: string; userId: string }, raw: unknown) {
  const input = salesMarketingSettingsSchema.parse(raw);
  const before = await getSalesMarketingSettings(actor.companyId);
  const data = { ...input, quotationDefaultTerms: input.quotationDefaultTerms || null, updatedByUserId: actor.userId };
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.salesMarketingSettings.upsert({ where: { companyId: actor.companyId }, create: { companyId: actor.companyId, ...data }, update: data });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        userId: actor.userId,
        tableName: "sales_marketing_settings",
        recordId: saved.id,
        action: "UPDATE",
        oldValues: { ...before, updatedAt: undefined },
        newValues: { ...input },
      },
      tx
    );
    return saved;
  });
  return getSalesMarketingSettings(row.companyId);
}

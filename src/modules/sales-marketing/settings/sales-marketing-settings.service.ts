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
  /** Phase 03: cap on the total rule discount per line, % of list price (null = no cap). */
  pricingMaxRuleDiscountPercent: null as number | null,
  /** Phase 06 forecast: default probabilities (%) for open quotations — defaults, not measured. */
  forecastProbabilityApproved: 30,
  forecastProbabilityIssued: 50,
  forecastProbabilityAccepted: 90,
  /** Complete periods averaged by the trend method. */
  forecastTrendLookback: 3,
  /** Opportunities not updated for this many days are flagged as stale. */
  forecastStaleDays: 60,
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
    pricingMaxRuleDiscountPercent: row.pricingMaxRuleDiscountPercent === null ? null : Number(row.pricingMaxRuleDiscountPercent),
    forecastProbabilityApproved: row.forecastProbabilityApproved,
    forecastProbabilityIssued: row.forecastProbabilityIssued,
    forecastProbabilityAccepted: row.forecastProbabilityAccepted,
    forecastTrendLookback: row.forecastTrendLookback,
    forecastStaleDays: row.forecastStaleDays,
    updatedAt: row.updatedAt,
  };
}

export const salesMarketingSettingsSchema = z
  .object({
    quotationApprovalMaxDiscountPercent: z.coerce.number().min(0).max(100),
    quotationApprovalMaxTotal: z.coerce.number().min(0).max(9_999_999_999),
    quotationDefaultValidityDays: z.coerce.number().int().min(1).max(365),
    quotationDefaultTerms: z.string().trim().max(10000).optional().or(z.literal("")).nullable(),
    // Omitted = keep the current value; "" / null = no cap.
    pricingMaxRuleDiscountPercent: z.union([z.literal(""), z.null(), z.coerce.number().min(0).max(100)]).optional(),
    // Phase 06 forecast settings — omitted = keep the current value.
    forecastProbabilityApproved: z.coerce.number().int().min(0).max(100).optional(),
    forecastProbabilityIssued: z.coerce.number().int().min(0).max(100).optional(),
    forecastProbabilityAccepted: z.coerce.number().int().min(0).max(100).optional(),
    forecastTrendLookback: z.coerce.number().int().min(1).max(24).optional(),
    forecastStaleDays: z.coerce.number().int().min(1).max(3650).optional(),
  })
  .strict();

export async function updateSalesMarketingSettings(actor: { companyId: string; userId: string }, raw: unknown) {
  const input = salesMarketingSettingsSchema.parse(raw);
  const before = await getSalesMarketingSettings(actor.companyId);
  const { pricingMaxRuleDiscountPercent: cap, ...rest } = input;
  const data = {
    ...rest,
    quotationDefaultTerms: input.quotationDefaultTerms || null,
    ...(cap === undefined ? {} : { pricingMaxRuleDiscountPercent: cap === "" || cap === null ? null : cap }),
    updatedByUserId: actor.userId,
  };
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

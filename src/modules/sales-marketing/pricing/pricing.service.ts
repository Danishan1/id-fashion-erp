import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import { priceLine, versionInForce, type EngineList, type PricingData, type PricingRequestLine, type PricingResult } from "./pricing-engine";

/**
 * Pricing service (Sales & Marketing Phase 03, 2026-10-29): loads exactly the
 * data the engine needs for a batch of lines (no N+1: one query per table) and
 * runs `priceLine` for each. This is the interface other modules use:
 *
 *   const results = await priceLines(actor, { date, customerId }, lines)
 *
 * A caller that stores a price must also store the result's `source`, `rules`
 * and `explanation` (the snapshot) and must never re-price a finalised
 * document. Pure read — safe to retry.
 */

export const MAX_PRICING_LINES = 200;

export interface PricingRequestContext {
  /** YYYY-MM-DD; defaults to today. */
  date?: string;
  /** Null / undefined = prospect (default price lists only). */
  customerId?: string | null;
}

/** Loads lists (with only the version in force and only the requested Styles' entries), rules, units, products. */
export async function loadPricingData(companyId: string, date: string, customerId: string | null, productIds: string[]): Promise<PricingData> {
  const ids = [...new Set(productIds)];
  const [products, units, listRows, rules] = await Promise.all([
    prisma.product.findMany({ where: { companyId, id: { in: ids }, itemType: "STYLE", deletedAt: null }, select: { id: true, styleName: true, styleCode: true, categoryId: true, baseUomId: true } }),
    prisma.unitOfMeasure.findMany({ select: { id: true, code: true, baseUnitId: true, conversionFactor: true } }),
    prisma.priceList.findMany({
      where: { companyId, OR: [{ kind: "DEFAULT" }, ...(customerId ? [{ kind: "CUSTOMER" as const, customerId }] : [])] },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        customerId: true,
        priority: true,
        isActive: true,
        versions: { where: { status: "APPROVED" }, select: { id: true, versionNumber: true, status: true, effectiveFrom: true, effectiveTo: true } },
      },
    }),
    prisma.discountRule.findMany({
      where: {
        companyId,
        status: "ACTIVE",
        AND: [
          { OR: [{ productId: null }, { productId: { in: ids } }] },
          { OR: [{ customerId: null }, ...(customerId ? [{ customerId }] : [])] },
        ],
      },
      take: 2000,
    }),
  ]);
  const lists: EngineList[] = listRows.map((l) => ({
    ...l,
    versions: l.versions.map((v) => ({ ...v, effectiveFrom: toIsoDate(v.effectiveFrom), effectiveTo: v.effectiveTo ? toIsoDate(v.effectiveTo) : null, entries: [] })),
  }));
  // Entries only for the version in force of each list, only for these Styles.
  const inForce = lists.map((l) => versionInForce(l, date)).flatMap((r) => ("version" in r ? [r.version] : []));
  const entries = inForce.length
    ? await prisma.priceListEntry.findMany({
        where: { versionId: { in: inForce.map((v) => v.id) }, productId: { in: ids } },
        select: { id: true, versionId: true, productId: true, uomId: true, minQuantity: true, unitPrice: true },
      })
    : [];
  for (const v of inForce) v.entries = entries.filter((e) => e.versionId === v.id).map((e) => ({ ...e, minQuantity: e.minQuantity.toString(), unitPrice: e.unitPrice.toString() }));
  return {
    lists,
    units: units.map((u) => ({ ...u, conversionFactor: u.conversionFactor.toString() })),
    products: products.map((p) => ({ id: p.id, name: `${p.styleName} (${p.styleCode})`, categoryId: p.categoryId, baseUomId: p.baseUomId })),
    rules: rules.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      discountType: r.discountType,
      value: r.value.toString(),
      stacking: r.stacking,
      priority: r.priority,
      productId: r.productId,
      categoryId: r.categoryId,
      customerId: r.customerId,
      priceListId: r.priceListId,
      minQuantity: r.minQuantity === null ? null : r.minQuantity.toString(),
      validFrom: toIsoDate(r.validFrom),
      validTo: r.validTo ? toIsoDate(r.validTo) : null,
    })),
  };
}

/** Prices a batch of lines for one customer (or prospect) on one date. */
export async function priceLines(actor: Pick<SalesActor, "companyId">, context: PricingRequestContext, lines: PricingRequestLine[]): Promise<PricingResult[]> {
  if (lines.length > MAX_PRICING_LINES) throw new BusinessRuleError("VALIDATION_ERROR", `Price at most ${MAX_PRICING_LINES} lines at a time.`);
  const date = context.date || todayIsoDate();
  const customerId = context.customerId || null;
  if (customerId) {
    const ok = await prisma.customer.findFirst({ where: { id: customerId, companyId: actor.companyId, deletedAt: null }, select: { id: true } });
    if (!ok) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: customerId });
  }
  if (!lines.length) return [];
  const [data, settings] = await Promise.all([
    loadPricingData(actor.companyId, date, customerId, lines.map((l) => l.productId)),
    getSalesMarketingSettings(actor.companyId),
  ]);
  return lines.map((l) => priceLine(l, { date, customerId, maxRuleDiscountPercent: settings.pricingMaxRuleDiscountPercent }, data));
}

// ── API: calculate / preview ─────────────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
export const calculateSchema = z
  .object({
    date: isoDate.optional(),
    customerId: z.string().uuid().optional().or(z.literal("")).nullable(),
    lines: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.coerce.number().positive().max(99_999_999),
          uomId: z.string().uuid().optional().or(z.literal("")).nullable(),
        })
      )
      .min(1)
      .max(MAX_PRICING_LINES),
  })
  .strict();

/**
 * POST /pricing/calculate. Allowed for pricing viewers (the preview screen)
 * and for people who write quotations (the quotation editor). Only default
 * lists and the requested customer's own lists are ever read, so the result
 * never shows another customer's prices.
 */
export async function calculatePrices(actor: SalesActor, raw: unknown) {
  const [pricingView, qCreate, qEdit] = await Promise.all([
    PermissionService.can(actor.userId, "sales_pricing", "view"),
    PermissionService.can(actor.userId, "sales_quotations", "create"),
    PermissionService.can(actor.userId, "sales_quotations", "edit"),
  ]);
  if (!pricingView && !qCreate && !qEdit) throw new BusinessRuleError("PERMISSION_DENIED", "You don't have access to pricing.");
  const input = calculateSchema.parse(raw);
  return priceLines(actor, { date: input.date, customerId: input.customerId || null }, input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, uomId: l.uomId || null })));
}

import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";

const CATEGORY = "profitability" as const;

const NOT_TRACKED = "Not Tracked";
const INCOMPLETE_MATERIAL_COST = "Incomplete (no BOM)";

const SUBTITLE =
  "Revenue from posted Sales Invoices; Material Cost from BOM × Product unit cost. Labour and Overhead are not tracked anywhere in this ERP's schema and are shown as Not Tracked rather than estimated.";

function formatMoney(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

function parseDateRange(filters: Record<string, string>): { dateFrom?: Date; dateTo?: Date } {
  return {
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Shared BOM-cost helper — loads a style's Bom + BomItems + material.unitCost
// ONCE per style per report invocation (cached in a Map) to avoid N+1 queries
// when many order lines across many orders share the same style. Deliberately
// the ONLY place this calculation lives — both reports below call it, never
// duplicating the logic.
// ---------------------------------------------------------------------------
interface StyleMaterialCostResult {
  /** Cost per ONE finished garment piece of this style, in the material's own base currency. */
  costPerUnit: number;
  /** False if this style has no BOM at all, OR any BomItem's material has a null unitCost. */
  available: boolean;
}

function makeStyleMaterialCostResolver(companyId: string) {
  const cache = new Map<string, Promise<StyleMaterialCostResult>>();

  async function computeStyleMaterialCostPerUnit(productId: string): Promise<StyleMaterialCostResult> {
    const cached = cache.get(productId);
    if (cached) return cached;

    const promise = (async (): Promise<StyleMaterialCostResult> => {
      const bom = await prisma.bom.findFirst({
        where: { companyId, productId },
        select: {
          items: {
            select: {
              quantityPerUnit: true,
              wastagePercentage: true,
              material: { select: { unitCost: true } },
            },
          },
        },
      });

      // No BOM at all for this style — Material Cost is unavailable, not zero.
      if (!bom) {
        return { costPerUnit: 0, available: false };
      }

      let costPerUnit = 0;
      let allMaterialsHaveCost = true;
      for (const item of bom.items) {
        const unitCost = item.material.unitCost;
        if (unitCost === null) {
          // A BomItem whose material has no unitCost set — its contribution
          // is skipped (treated as 0), but this makes the resulting total an
          // undercount, so the whole style/order is flagged unavailable
          // rather than silently understated.
          allMaterialsHaveCost = false;
          continue;
        }
        const effectiveQtyPerUnit = Number(item.quantityPerUnit) * (1 + Number(item.wastagePercentage) / 100);
        costPerUnit += effectiveQtyPerUnit * Number(unitCost);
      }

      return { costPerUnit, available: allMaterialsHaveCost };
    })();

    cache.set(productId, promise);
    return promise;
  }

  return computeStyleMaterialCostPerUnit;
}

// ---------------------------------------------------------------------------
// Shared source query — every posted (non-cancelled) Sales Invoice's items,
// joined back to their originating SalesOrderItem for the ordered quantity
// (the invoice's own `quantity` field already denormalizes this per-item, so
// it is used directly rather than re-summing breakdown rows a second time).
// ---------------------------------------------------------------------------
interface InvoiceLineRow {
  salesOrderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  productId: string;
  styleCode: string;
  styleName: string;
  quantity: number;
  lineTotal: number;
}

async function loadInvoiceLines(companyId: string, dateFrom?: Date, dateTo?: Date, customerId?: string): Promise<InvoiceLineRow[]> {
  const invoices = await prisma.salesInvoice.findMany({
    where: {
      companyId,
      status: { not: "CANCELLED" },
      ...(customerId ? { customerId } : {}),
      ...(dateFrom || dateTo ? { invoiceDate: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
    },
    select: {
      salesOrderId: true,
      customerId: true,
      customer: { select: { name: true } },
      salesOrder: { select: { orderNumber: true } },
      items: {
        select: {
          quantity: true,
          lineTotal: true,
          productId: true,
          product: { select: { styleCode: true, styleName: true } },
        },
      },
    },
  });

  const rows: InvoiceLineRow[] = [];
  for (const inv of invoices) {
    for (const item of inv.items) {
      rows.push({
        salesOrderId: inv.salesOrderId,
        orderNumber: inv.salesOrder.orderNumber,
        customerId: inv.customerId,
        customerName: inv.customer.name,
        productId: item.productId,
        styleCode: item.product.styleCode,
        styleName: item.product.styleName,
        quantity: item.quantity,
        lineTotal: Number(item.lineTotal),
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Order Profitability — one row per Sales Order with at least one posted
// invoice line.
// ---------------------------------------------------------------------------
async function getOrderProfitabilityDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const lines = await loadInvoiceLines(companyId, dateFrom, dateTo, filters.customerId);
  const resolveStyleMaterialCost = makeStyleMaterialCostResolver(companyId);

  interface OrderAgg {
    salesOrderId: string;
    orderNumber: string;
    customer: string;
    revenue: number;
    materialCost: number;
    materialCostAvailable: boolean;
  }

  const byOrder = new Map<string, OrderAgg>();
  for (const line of lines) {
    const existing = byOrder.get(line.salesOrderId) ?? {
      salesOrderId: line.salesOrderId,
      orderNumber: line.orderNumber,
      customer: line.customerName,
      revenue: 0,
      materialCost: 0,
      materialCostAvailable: true,
    };
    existing.revenue += line.lineTotal;

    const styleCost = await resolveStyleMaterialCost(line.productId);
    if (!styleCost.available) {
      existing.materialCostAvailable = false;
    } else {
      existing.materialCost += styleCost.costPerUnit * line.quantity;
    }

    byOrder.set(line.salesOrderId, existing);
  }

  const orderAggs = [...byOrder.values()].sort((a, b) => b.revenue - a.revenue);

  const cleanedRows = orderAggs.map((o) => {
    const grossProfit = o.materialCostAvailable ? o.revenue - o.materialCost : null;
    const marginPercent = o.materialCostAvailable && o.revenue !== 0 ? (grossProfit! / o.revenue) * 100 : o.materialCostAvailable ? 0 : null;
    return {
      salesOrderId: o.salesOrderId,
      orderNumber: o.orderNumber,
      customer: o.customer,
      revenue: formatMoney(o.revenue),
      materialCost: o.materialCostAvailable ? formatMoney(o.materialCost) : INCOMPLETE_MATERIAL_COST,
      grossProfit: grossProfit !== null ? formatMoney(grossProfit) : INCOMPLETE_MATERIAL_COST,
      marginPercent: marginPercent !== null ? `${marginPercent.toFixed(2)}%` : INCOMPLETE_MATERIAL_COST,
      labourCost: NOT_TRACKED,
      overheadCost: NOT_TRACKED,
    };
  });

  // Totals: Revenue summed across all orders; Material Cost summed ONLY over
  // orders where it was available. This partial-sum is a known limitation —
  // the "Material Cost" total will understate true spend whenever any order
  // has an incomplete BOM/unit-cost chain, by design (never fabricated).
  const totalRevenue = orderAggs.reduce((s, o) => s + o.revenue, 0);
  const materialCostAggs = orderAggs.filter((o) => o.materialCostAvailable);
  const totalMaterialCost = materialCostAggs.reduce((s, o) => s + o.materialCost, 0);

  return {
    title: "Order Profitability",
    subtitle: SUBTITLE,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer" }),
    columns: [
      { key: "orderNumber", label: "Order Number", linkTo: "salesOrder" },
      { key: "customer", label: "Customer" },
      { key: "revenue", label: "Revenue", type: "text", align: "right" },
      { key: "materialCost", label: "Material Cost", type: "text", align: "right" },
      { key: "grossProfit", label: "Gross Profit", type: "text", align: "right" },
      { key: "marginPercent", label: "Margin %", type: "text", align: "right" },
      { key: "labourCost", label: "Labour Cost", type: "text" },
      { key: "overheadCost", label: "Overhead Cost", type: "text" },
    ],
    rows: cleanedRows,
    totals: {
      revenue: formatMoney(totalRevenue),
      materialCost:
        materialCostAggs.length === orderAggs.length && orderAggs.length > 0
          ? formatMoney(totalMaterialCost)
          : `${formatMoney(totalMaterialCost)} (partial — ${orderAggs.length - materialCostAggs.length} order(s) missing a complete BOM)`,
    },
    meta: { page: 1, pageSize: cleanedRows.length, totalCount: cleanedRows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Style Profitability — same computation, aggregated by style (productId)
// across every order line instead of by order.
// ---------------------------------------------------------------------------
async function getStyleProfitabilityDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateTo } = parseDateRange(filters);
  const lines = await loadInvoiceLines(companyId, dateFrom, dateTo, filters.customerId);
  const resolveStyleMaterialCost = makeStyleMaterialCostResolver(companyId);

  interface StyleAgg {
    productId: string;
    styleCode: string;
    styleName: string;
    revenue: number;
    materialCost: number;
    materialCostAvailable: boolean;
  }

  const byStyle = new Map<string, StyleAgg>();
  for (const line of lines) {
    const existing = byStyle.get(line.productId) ?? {
      productId: line.productId,
      styleCode: line.styleCode,
      styleName: line.styleName,
      revenue: 0,
      materialCost: 0,
      materialCostAvailable: true,
    };
    existing.revenue += line.lineTotal;

    const styleCost = await resolveStyleMaterialCost(line.productId);
    if (!styleCost.available) {
      existing.materialCostAvailable = false;
    } else {
      existing.materialCost += styleCost.costPerUnit * line.quantity;
    }

    byStyle.set(line.productId, existing);
  }

  const styleAggs = [...byStyle.values()].sort((a, b) => b.revenue - a.revenue);

  const cleanedRows = styleAggs.map((s) => {
    const grossProfit = s.materialCostAvailable ? s.revenue - s.materialCost : null;
    const marginPercent = s.materialCostAvailable && s.revenue !== 0 ? (grossProfit! / s.revenue) * 100 : s.materialCostAvailable ? 0 : null;
    return {
      productId: s.productId,
      styleCode: s.styleCode,
      styleName: s.styleName,
      revenue: formatMoney(s.revenue),
      materialCost: s.materialCostAvailable ? formatMoney(s.materialCost) : INCOMPLETE_MATERIAL_COST,
      grossProfit: grossProfit !== null ? formatMoney(grossProfit) : INCOMPLETE_MATERIAL_COST,
      marginPercent: marginPercent !== null ? `${marginPercent.toFixed(2)}%` : INCOMPLETE_MATERIAL_COST,
      labourCost: NOT_TRACKED,
      overheadCost: NOT_TRACKED,
    };
  });

  const totalRevenue = styleAggs.reduce((sum, s) => sum + s.revenue, 0);
  const materialCostAggs = styleAggs.filter((s) => s.materialCostAvailable);
  const totalMaterialCost = materialCostAggs.reduce((sum, s) => sum + s.materialCost, 0);

  return {
    title: "Style Profitability",
    subtitle: SUBTITLE,
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To", customerId: "Customer" }),
    columns: [
      { key: "styleCode", label: "Style Code" },
      { key: "styleName", label: "Style Name", linkTo: "product" },
      { key: "revenue", label: "Revenue", type: "text", align: "right" },
      { key: "materialCost", label: "Material Cost", type: "text", align: "right" },
      { key: "grossProfit", label: "Gross Profit", type: "text", align: "right" },
      { key: "marginPercent", label: "Margin %", type: "text", align: "right" },
      { key: "labourCost", label: "Labour Cost", type: "text" },
      { key: "overheadCost", label: "Overhead Cost", type: "text" },
    ],
    rows: cleanedRows,
    totals: {
      revenue: formatMoney(totalRevenue),
      materialCost:
        materialCostAggs.length === styleAggs.length && styleAggs.length > 0
          ? formatMoney(totalMaterialCost)
          : `${formatMoney(totalMaterialCost)} (partial — ${styleAggs.length - materialCostAggs.length} style(s) missing a complete BOM)`,
    },
    meta: { page: 1, pageSize: cleanedRows.length, totalCount: cleanedRows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({ category: CATEGORY, key: "order-profitability", title: "Order Profitability", buildDescriptor: getOrderProfitabilityDescriptor });
registerReport({ category: CATEGORY, key: "style-profitability", title: "Style Profitability", buildDescriptor: getStyleProfitabilityDescriptor });

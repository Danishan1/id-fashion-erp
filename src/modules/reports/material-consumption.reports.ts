import { prisma } from "@/core/db/client";
import type { ReportDescriptor } from "@/core/reports/report-types";
import { registerReport } from "./registry";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { parseReportDateRange } from "./report-date-range";

const CATEGORY = "material-consumption" as const;

function filtersApplied(filters: Record<string, string>, labels: Record<string, string>) {
  return Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v }));
}

// ---------------------------------------------------------------------------
// 1. Material Consumption Variance — per Production Order: BOM-computed
// requirement (planned quantity x each BomItem's effective qty/unit,
// converted to the material's base UOM via the existing convertUomQuantity
// helper — never re-derived) vs. actual issued (summed straight from the
// InventoryTransaction ledger, the sole source of truth for real stock
// movement, scoped to MATERIAL_ISSUE lines referencing a Material Request
// raised against this Production Order).
// ---------------------------------------------------------------------------
async function getMaterialConsumptionVarianceDescriptor(companyId: string, generatedByName: string): Promise<ReportDescriptor> {
  const orders = await prisma.productionOrder.findMany({
    where: { companyId, bomId: { not: null } },
    select: {
      id: true,
      orderNumber: true,
      plannedQuantity: true,
      product: { select: { styleCode: true, styleName: true } },
      bom: {
        select: {
          // Only the APPROVED version's lines — an unapproved edit-in-
          // progress must never silently feed a consumption-variance report
          // any more than it may feed MRP itself (see mrp.service.ts).
          approvedVersion: {
            select: {
              items: {
                select: {
                  quantityPerUnit: true,
                  wastagePercentage: true,
                  uomId: true,
                  uom: { select: { id: true, baseUnitId: true, conversionFactor: true } },
                  material: {
                    select: {
                      id: true,
                      styleName: true,
                      baseUomId: true,
                      baseUom: { select: { id: true, baseUnitId: true, conversionFactor: true, name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const materialRequests = await prisma.materialRequest.findMany({
    where: { companyId, productionOrderId: { in: orders.map((o) => o.id) } },
    select: { id: true, productionOrderId: true },
  });
  const requestIdsByOrder = new Map<string, string[]>();
  for (const mr of materialRequests) {
    if (!mr.productionOrderId) continue;
    const list = requestIdsByOrder.get(mr.productionOrderId) ?? [];
    list.push(mr.id);
    requestIdsByOrder.set(mr.productionOrderId, list);
  }

  const allRequestIds = materialRequests.map((mr) => mr.id);
  const issueLines =
    allRequestIds.length > 0
      ? await prisma.inventoryTransaction.findMany({
          where: { companyId, referenceModule: "MATERIAL_REQUEST", referenceRecordId: { in: allRequestIds }, transactionType: "MATERIAL_ISSUE" },
          select: { referenceRecordId: true, productId: true, quantity: true },
        })
      : [];
  // requestId -> productId -> abs issued qty (ledger quantity is negative for an issue).
  const issuedByRequestAndProduct = new Map<string, Map<string, number>>();
  for (const line of issueLines) {
    const byProduct = issuedByRequestAndProduct.get(line.referenceRecordId) ?? new Map<string, number>();
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? 0) + Math.abs(Number(line.quantity)));
    issuedByRequestAndProduct.set(line.referenceRecordId, byProduct);
  }

  interface Row {
    productionOrderId: string;
    orderNumber: string;
    style: string;
    material: string;
    requiredQuantity: number | null;
    actualIssued: number;
    variance: number | null;
    unit: string;
  }
  const rows: Row[] = [];

  for (const order of orders) {
    const approvedItems = order.bom?.approvedVersion?.items ?? [];
    if (approvedItems.length === 0) continue;
    const requestIds = requestIdsByOrder.get(order.id) ?? [];

    for (const item of approvedItems) {
      let requiredQuantity: number | null = null;
      if (item.material.baseUom) {
        const effectiveQtyPerUnit = Number(item.quantityPerUnit) * (1 + Number(item.wastagePercentage) / 100);
        const totalInBomUom = effectiveQtyPerUnit * Number(order.plannedQuantity);
        requiredQuantity = convertUomQuantity(totalInBomUom, item.uom, item.material.baseUom);
      }

      let actualIssued = 0;
      for (const reqId of requestIds) {
        actualIssued += issuedByRequestAndProduct.get(reqId)?.get(item.material.id) ?? 0;
      }

      rows.push({
        productionOrderId: order.id,
        orderNumber: order.orderNumber,
        style: `${order.product.styleCode} — ${order.product.styleName}`,
        material: item.material.styleName,
        requiredQuantity,
        actualIssued,
        variance: requiredQuantity !== null ? actualIssued - requiredQuantity : null,
        unit: item.material.baseUom?.name ?? "—",
      });
    }
  }

  const displayRows = rows.map((r) => ({
    ...r,
    requiredQuantity: r.requiredQuantity !== null ? r.requiredQuantity.toFixed(4) : "Unconvertible UOM",
    actualIssued: r.actualIssued.toFixed(4),
    variance: r.variance !== null ? r.variance.toFixed(4) : "—",
  }));

  return {
    title: "Material Consumption Variance",
    subtitle:
      "BOM-computed requirement (planned quantity x BOM, converted to base UOM) vs. actual issued quantity from the inventory ledger, per Production Order.",
    filtersApplied: [],
    columns: [
      { key: "orderNumber", label: "Production Order", linkTo: "productionOrder" },
      { key: "style", label: "Style" },
      { key: "material", label: "Material" },
      { key: "requiredQuantity", label: "Required (BOM)", type: "text", align: "right" },
      { key: "actualIssued", label: "Actual Issued", type: "text", align: "right" },
      { key: "variance", label: "Variance", type: "text", align: "right" },
      { key: "unit", label: "Unit" },
    ],
    rows: displayRows,
    meta: { page: 1, pageSize: displayRows.length, totalCount: displayRows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

// ---------------------------------------------------------------------------
// 2. Consumption by Material Category — actual MATERIAL_ISSUE ledger
// quantity (the same real, source-of-truth movement as report #1 above)
// grouped by the material's own materialCategory (Fabric/Trims/Zips/Buttons/
// Packaging/Accessories/Other) rather than by individual material.
// ---------------------------------------------------------------------------
async function getConsumptionByMaterialCategoryDescriptor(companyId: string, generatedByName: string, filters: Record<string, string>): Promise<ReportDescriptor> {
  const { dateFrom, dateToExclusive } = parseReportDateRange(filters);
  const lines = await prisma.inventoryTransaction.findMany({
    where: {
      companyId,
      transactionType: "MATERIAL_ISSUE",
      ...(dateFrom || dateToExclusive ? { performedAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateToExclusive ? { lt: dateToExclusive } : {}) } } : {}),
    },
    select: { quantity: true, product: { select: { materialCategory: true } } },
  });

  const byCategory = new Map<string, number>();
  for (const line of lines) {
    const category = line.product.materialCategory ?? "UNSPECIFIED";
    byCategory.set(category, (byCategory.get(category) ?? 0) + Math.abs(Number(line.quantity)));
  }

  const rows = [...byCategory.entries()].map(([category, quantity]) => ({ category, quantity })).sort((a, b) => b.quantity - a.quantity);

  return {
    title: "Consumption by Material Category",
    subtitle: "Actual material issued (from the inventory ledger) grouped by material category. Units are mixed across categories — this is a quantity count, not a value.",
    filtersApplied: filtersApplied(filters, { dateFrom: "Date From", dateTo: "Date To" }),
    columns: [
      { key: "category", label: "Material Category" },
      { key: "quantity", label: "Quantity Issued", type: "number", align: "right" },
    ],
    rows,
    totals: { quantity: rows.reduce((s, r) => s + r.quantity, 0) },
    meta: { page: 1, pageSize: rows.length, totalCount: rows.length },
    generatedAt: new Date().toISOString(),
    generatedByName,
  };
}

registerReport({
  category: CATEGORY,
  key: "material-consumption-variance",
  title: "Material Consumption Variance",
  buildDescriptor: (c, g) => getMaterialConsumptionVarianceDescriptor(c, g),
  pdfOrientation: "landscape",
});
registerReport({
  category: CATEGORY,
  key: "consumption-by-material-category",
  title: "Consumption by Material Category",
  buildDescriptor: getConsumptionByMaterialCategoryDescriptor,
});

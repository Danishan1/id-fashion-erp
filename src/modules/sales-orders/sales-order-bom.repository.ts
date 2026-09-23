import { prisma } from "@/core/db/client";
import type { Prisma, SalesOrderBomSourceType } from "@prisma/client";

const OVERRIDE_INCLUDE = {
  originalMaterial: { select: { id: true, styleName: true, styleCode: true } },
  effectiveMaterial: { select: { id: true, styleName: true, styleCode: true } },
  color: { select: { id: true, name: true, hexValue: true } },
  uom: { select: { id: true, code: true, name: true } },
  changedBy: { select: { id: true, fullName: true } },
  deactivatedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.SalesOrderBomOverrideInclude;

export interface ExistingSalesOrderLineRow {
  id: string;
  lineNumber: number;
  sourceType: SalesOrderBomSourceType;
  bomVersionId: string | null;
  sampleVersionId: string | null;
  items: { productId: string; sampleRequestId: string | null }[];
}

const EXISTING_LINE_SELECT = {
  id: true,
  lineNumber: true,
  sourceType: true,
  bomVersionId: true,
  sampleVersionId: true,
  items: { select: { productId: true, sampleRequestId: true } },
} satisfies Prisma.SalesOrderLineSelect;

export const SalesOrderLineRepository = {
  /** Every SalesOrderLine for this order, including dormant ones with no
   * live item (a prior edit's "deleted line") — each paired with whichever
   * SalesOrderItem currently points at it, if any. This is the "before this
   * edit" state buildReconciledItemWritePlan() decides reuse-vs-new against. */
  findExistingForOrder: (salesOrderId: string): Promise<ExistingSalesOrderLineRow[]> =>
    prisma.salesOrderLine.findMany({
      where: { salesOrderId },
      orderBy: { lineNumber: "asc" },
      select: EXISTING_LINE_SELECT,
    }),

  findExistingForOrderInTx: (tx: Prisma.TransactionClient, salesOrderId: string): Promise<ExistingSalesOrderLineRow[]> =>
    tx.salesOrderLine.findMany({
      where: { salesOrderId },
      orderBy: { lineNumber: "asc" },
      select: EXISTING_LINE_SELECT,
    }),

  findByIdWithOrder: (companyId: string, id: string) =>
    prisma.salesOrderLine.findFirst({
      where: { id, companyId },
      include: {
        salesOrder: { select: { id: true, status: true, requestedByUserId: true } },
        items: { select: { id: true, productId: true, sampleRequestId: true } },
      },
    }),

  /** The explicit "Revise/Refresh BOM" action's own write — the only place
   * outside line creation that ever touches these fields; an ordinary edit
   * never calls this. */
  updateSnapshot: (
    id: string,
    data: {
      sourceType: SalesOrderBomSourceType;
      bomVersionId: string | null;
      sampleVersionId: string | null;
      snapshotTakenAt: Date;
      snapshotTakenByUserId: string;
    }
  ) => prisma.salesOrderLine.update({ where: { id }, data }),
};

/**
 * CRUD for SalesOrderBomOverride — the deliberate, customer/buyer-driven
 * per-line BOM customization layer (Section 4 of the schema's own doc
 * comment on the model). Never a hard delete anywhere: `deactivate` is the
 * only mutation an existing row ever gets, preserving the full audit trail
 * exactly like SampleVersion's own SUPERSEDED (never deleted) convention.
 */
export const SalesOrderBomOverrideRepository = {
  findManyForLine: (salesOrderLineId: string) =>
    prisma.salesOrderBomOverride.findMany({
      where: { salesOrderLineId },
      orderBy: { changedAt: "desc" },
      include: OVERRIDE_INCLUDE,
    }),

  findById: (companyId: string, id: string) => prisma.salesOrderBomOverride.findFirst({ where: { id, companyId }, include: OVERRIDE_INCLUDE }),

  create: (data: Prisma.SalesOrderBomOverrideUncheckedCreateInput) =>
    prisma.salesOrderBomOverride.create({ data, include: OVERRIDE_INCLUDE }),

  deactivate: (id: string, deactivatedByUserId: string) =>
    prisma.salesOrderBomOverride.update({
      where: { id },
      data: { isActive: false, deactivatedByUserId, deactivatedAt: new Date() },
      include: OVERRIDE_INCLUDE,
    }),
};

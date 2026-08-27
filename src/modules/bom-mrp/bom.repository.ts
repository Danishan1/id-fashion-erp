import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const ITEMS_INCLUDE = {
  material: {
    select: {
      id: true,
      styleName: true,
      styleCode: true,
      baseUomId: true,
      baseUom: { select: { id: true, name: true, code: true, baseUnitId: true, conversionFactor: true } },
      defaultSupplierId: true,
      unitCost: true,
    },
  },
  color: { select: { id: true, name: true, hexValue: true } },
  uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
} as const;

// Every version, newest first, each with its own items — the BOM editor
// needs the full history (to show "which version is this"), while MRP/
// Production only ever care about `approvedVersion` specifically (see
// below). Keeping one query shape for both avoids a second, divergent
// "just the versions" query.
const BOM_WITH_VERSIONS_INCLUDE = {
  versions: {
    include: { items: { include: ITEMS_INCLUDE }, createdBy: { select: { id: true, fullName: true } }, approvedBy: { select: { id: true, fullName: true } } },
    orderBy: { versionNumber: "desc" as const },
  },
  approvedVersion: { include: { items: { include: ITEMS_INCLUDE } } },
} satisfies Prisma.BomInclude;

export const BomRepository = {
  findByProductId: (companyId: string, productId: string) =>
    prisma.bom.findFirst({
      where: { productId, companyId },
      include: BOM_WITH_VERSIONS_INCLUDE,
    }),

  findVersionById: (companyId: string, versionId: string) =>
    prisma.bomVersion.findFirst({
      where: { id: versionId, bom: { companyId } },
      include: { items: { include: ITEMS_INCLUDE }, bom: true },
    }),

  /**
   * Creates the Bom header on first save (it's 1:1 with the Style and
   * doesn't exist until a BOM is authored), then either replaces the
   * CURRENT version's items in place (while it's still DRAFT — the normal
   * "keep editing before approval" case) or mints a brand-new DRAFT version
   * (once the current one is APPROVED, so approved history is never
   * silently rewritten). Mirrors Sales/Purchase Orders' own replaceItems()
   * shape for the item-list part.
   */
  saveDraftWithItems: (
    companyId: string,
    productId: string,
    userId: string,
    notes: string | null,
    items: Array<{
      materialId: string;
      colorId: string | null;
      quantityPerUnit: number;
      wastagePercentage: number;
      uomId: string;
      notes: string | null;
    }>
  ) =>
    prisma.$transaction(async (tx) => {
      let bom = await tx.bom.findFirst({ where: { productId, companyId } });
      if (!bom) {
        bom = await tx.bom.create({ data: { companyId, productId } });
      }

      const currentVersion =
        bom.currentVersionNumber > 0
          ? await tx.bomVersion.findUniqueOrThrow({ where: { bomId_versionNumber: { bomId: bom.id, versionNumber: bom.currentVersionNumber } } })
          : null;

      let versionId: string;
      if (currentVersion && currentVersion.status === "DRAFT") {
        // Still being authored/edited before approval — update in place,
        // no new version number consumed for a typo-fix during drafting.
        await tx.bomVersion.update({ where: { id: currentVersion.id }, data: { notes } });
        await tx.bomItem.deleteMany({ where: { bomVersionId: currentVersion.id } });
        versionId = currentVersion.id;
      } else {
        // No version yet, or the current one is already APPROVED — mint a
        // real new version rather than touching locked, approved history.
        const nextVersionNumber = bom.currentVersionNumber + 1;
        const created = await tx.bomVersion.create({
          data: { bomId: bom.id, versionNumber: nextVersionNumber, status: "DRAFT", notes, createdByUserId: userId },
        });
        await tx.bom.update({ where: { id: bom.id }, data: { currentVersionNumber: nextVersionNumber } });
        versionId = created.id;
      }

      if (items.length > 0) {
        await tx.bomItem.createMany({ data: items.map((item) => ({ ...item, bomVersionId: versionId })) });
      }

      return tx.bom.findFirstOrThrow({ where: { id: bom.id }, include: BOM_WITH_VERSIONS_INCLUDE });
    }),

  /**
   * Approves the given DRAFT version: flips it to APPROVED, points
   * `Bom.approvedVersionId` at it, and — if a different version was
   * previously approved — flips that one to SUPERSEDED in the same
   * transaction. This is the one and only place `approvedVersionId` ever
   * changes, so "which version MRP/Production use" can never drift from
   * "which version was actually approved."
   */
  approveVersionInTx: (bomId: string, versionId: string, userId: string) =>
    prisma.$transaction(async (tx) => {
      const bom = await tx.bom.findUniqueOrThrow({ where: { id: bomId } });

      if (bom.approvedVersionId && bom.approvedVersionId !== versionId) {
        await tx.bomVersion.update({ where: { id: bom.approvedVersionId }, data: { status: "SUPERSEDED" } });
      }

      await tx.bomVersion.update({
        where: { id: versionId },
        data: { status: "APPROVED", approvedByUserId: userId, approvedAt: new Date() },
      });

      return tx.bom.update({
        where: { id: bomId },
        data: { approvedVersionId: versionId },
        include: BOM_WITH_VERSIONS_INCLUDE,
      });
    }),

  countItemsByProductIds: (companyId: string, productIds: string[]) =>
    prisma.bom.findMany({
      where: { companyId, productId: { in: productIds } },
      select: { productId: true, approvedVersion: { select: { _count: { select: { items: true } } } } },
    }),

  /** Used by the MRP calculator to look up several styles' BOMs at once —
   * only the APPROVED version's items are ever returned; an unapproved
   * edit-in-progress must never silently change what material planning
   * relies on. */
  findManyByProductIds: (companyId: string, productIds: string[]) =>
    prisma.bom.findMany({
      where: { companyId, productId: { in: productIds } },
      select: { id: true, productId: true, approvedVersion: { select: { id: true, items: { include: ITEMS_INCLUDE } } } },
    }),

  /** Styles with their BOM line count, for the /bom-mrp landing list —
   * counts the APPROVED version's lines (an unapproved draft with lines
   * shouldn't read as "this style is ready", matching the same approved-
   * only discipline as findManyByProductIds). Takes explicit orderBy/skip/
   * take (not a spread `...args`) so Prisma's payload type inference for
   * the `include` below isn't erased by a generically typed args object. */
  findStylesWithBomStatus: (
    where: Prisma.ProductWhereInput,
    args: { orderBy: Prisma.ProductOrderByWithRelationInput; skip: number; take: number }
  ) =>
    prisma.product.findMany({
      where,
      include: { bom: { select: { id: true, approvedVersionId: true, approvedVersion: { select: { _count: { select: { items: true } } } } } } },
      orderBy: args.orderBy,
      skip: args.skip,
      take: args.take,
    }),

  countStyles: (where: Prisma.ProductWhereInput) => prisma.product.count({ where }),
};

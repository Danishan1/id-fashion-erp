import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

const SUBSTITUTION_INCLUDE = {
  originalMaterial: { select: { id: true, styleName: true, styleCode: true } },
  substituteMaterial: { select: { id: true, styleName: true, styleCode: true } },
  // baseUnitId/conversionFactor (not just id/code/name) so findById's own
  // result can feed straight into convertUomQuantity when re-validating a
  // substitution's quantity at approve time — see
  // material-substitution.service.ts's decideMaterialSubstitution().
  uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } },
  requestedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  substituteColor: { select: { id: true, name: true } },
} satisfies Prisma.MaterialSubstitutionInclude;

export const MaterialSubstitutionRepository = {
  /** Every substitution ever raised against this line — PENDING, APPROVED,
   * REJECTED alike, newest first. Never filtered to "active only": the full
   * decision history (who proposed what, who approved/rejected it, when) is
   * the point, matching this project's "never truly delete, preserve
   * traceability" convention used throughout (SalesOrderBomOverride,
   * SampleVersion's SUPERSEDED). */
  findManyForLine: (materialRequestItemId: string) =>
    prisma.materialSubstitution.findMany({
      where: { materialRequestItemId },
      orderBy: { requestedAt: "desc" },
      include: SUBSTITUTION_INCLUDE,
    }),

  findById: (companyId: string, id: string) => prisma.materialSubstitution.findFirst({ where: { id, companyId }, include: SUBSTITUTION_INCLUDE }),

  /** PENDING and APPROVED (not yet issued) rows for one line, converted to
   * base UOM by the caller — the "already committed" total a new proposal's
   * own quantity is capped against, so a store user can't propose several
   * substitutions that together would exceed what the line actually needs,
   * even before any of them is physically issued. */
  findActiveForLineQuantityCheck: (materialRequestItemId: string) =>
    prisma.materialSubstitution.findMany({
      where: { materialRequestItemId, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true, quantity: true, uom: { select: { id: true, code: true, name: true, baseUnitId: true, conversionFactor: true } } },
    }),

  create: (data: Prisma.MaterialSubstitutionUncheckedCreateInput) => prisma.materialSubstitution.create({ data, include: SUBSTITUTION_INCLUDE }),

  /** Race-safe approve/reject — the `where` clause re-asserts the row is
   * still PENDING, so two concurrent decisions on the same substitution can
   * never both succeed (the same guarded-conditional-update idiom this
   * project already uses everywhere a status transition matters —
   * SalesOrder/GoodsReceipt/JobOrder all follow it). */
  decideInTx: (
    tx: Prisma.TransactionClient,
    id: string,
    data: { status: "APPROVED" | "REJECTED"; approvedByUserId: string; approvedAt: Date; approvalRemark: string | null }
  ) => tx.materialSubstitution.updateMany({ where: { id, status: "PENDING" }, data }),

  /** Stamps the real InventoryTransaction this substitution was actually
   * posted against, once issued (Phase 6) — the workflow/audit pointer,
   * never a second ledger; InventoryTransaction remains the sole physical-
   * stock source of truth. */
  setInventoryTransactionInTx: (tx: Prisma.TransactionClient, id: string, inventoryTransactionId: string) =>
    tx.materialSubstitution.update({ where: { id }, data: { inventoryTransactionId } }),
};

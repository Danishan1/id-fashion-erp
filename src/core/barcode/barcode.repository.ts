import { prisma } from "@/core/db/client";
import type { BarcodeEntityType, Prisma } from "@prisma/client";

/**
 * Central Barcode registry repository — see prisma/schema.prisma's own
 * Barcode model doc comment for the full design rationale (2026-09-29).
 * Deliberately thin: no query here has real business logic of its own, that
 * lives in barcode.service.ts.
 */
export const BarcodeRepository = {
  /** Participates in a caller-owned transaction (e.g. Goods Receipt's roll-creation transaction, Lot creation) or the plain client when no transaction is in flight (e.g. the manual "Generate Barcode" action). */
  createInTx(
    client: Prisma.TransactionClient | typeof prisma,
    data: { companyId: string; code: string; entityType: BarcodeEntityType; entityId: string; createdByUserId?: string | null }
  ) {
    return client.barcode.create({ data });
  },

  /** Company-scoped, ACTIVE-only lookup by code — the one query the universal resolve endpoint runs. A code from another company or a DISABLED one both come back null, never distinguished from "unknown code" (see barcode.service.ts's resolveBarcode). */
  findActiveByCode(companyId: string, code: string) {
    return prisma.barcode.findFirst({ where: { companyId, code, status: "ACTIVE" } });
  },

  /** The currently-ACTIVE barcode for one entity, if any — used to make barcode generation idempotent (calling it twice for the same entity returns the existing row instead of erroring). */
  findActiveByEntity(companyId: string, entityType: BarcodeEntityType, entityId: string) {
    return prisma.barcode.findFirst({ where: { companyId, entityType, entityId, status: "ACTIVE" } });
  },

  /** Any-status lookup by code — used to tell apart "this exact code is already registered to a DIFFERENT entity" (a real conflict) from "this code belongs to THIS SAME entity's own now-disabled row" (see registerBarcode's re-activation path) when a code-derivation rule reuses a stable, deterministic value (Lot.lotNumber, Product.styleCode) rather than minting a fresh one. */
  findAnyByCode(companyId: string, code: string) {
    return prisma.barcode.findFirst({ where: { companyId, code } });
  },

  reactivate(companyId: string, id: string) {
    return prisma.barcode.updateMany({ where: { companyId, id }, data: { status: "ACTIVE" } });
  },

  findById(companyId: string, id: string) {
    return prisma.barcode.findFirst({ where: { companyId, id } });
  },

  /** Every barcode (any status) ever issued for one entity — the print/reprint history a management screen shows, oldest first so a reprint's own lineage reads top-to-bottom. */
  findAllByEntity(companyId: string, entityType: BarcodeEntityType, entityId: string) {
    return prisma.barcode.findMany({ where: { companyId, entityType, entityId }, orderBy: { createdAt: "asc" } });
  },

  findMany(where: Prisma.BarcodeWhereInput, options: { orderBy: Prisma.BarcodeOrderByWithRelationInput; skip: number; take: number }) {
    return prisma.barcode.findMany({ where, ...options, include: { createdBy: { select: { fullName: true } } } });
  },

  count(where: Prisma.BarcodeWhereInput) {
    return prisma.barcode.count({ where });
  },

  disable(companyId: string, id: string) {
    return prisma.barcode.updateMany({ where: { companyId, id, status: "ACTIVE" }, data: { status: "DISABLED" } });
  },

  /** Best-effort cleanup for an entity whose underlying row was destroyed and recreated with a new id (Dispatch's Carton delete-and-recreate-on-every-edit) — the old barcode row has nothing left to point at, so it's deleted outright rather than merely disabled (this isn't the "damaged label, mint a replacement" case the ACTIVE/DISABLED distinction exists for). */
  deleteManyByEntityIds(companyId: string, entityType: BarcodeEntityType, entityIds: string[]) {
    if (entityIds.length === 0) return Promise.resolve({ count: 0 });
    return prisma.barcode.deleteMany({ where: { companyId, entityType, entityId: { in: entityIds } } });
  },

  /** Every CARTON barcode of one dispatch ("<dispatchNumber>-C<n>"), whatever carton id it points at — cartons are recreated with new ids on every edit, so old rows can't be found by id alone. */
  deleteCartonCodesForDispatch(companyId: string, dispatchNumber: string) {
    return prisma.barcode.deleteMany({ where: { companyId, entityType: "CARTON", code: { startsWith: `${dispatchNumber}-C` } } });
  },
};

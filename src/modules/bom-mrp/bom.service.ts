import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { ListQuery } from "@/lib/list-query";
import { convertUomQuantity } from "@/lib/uom-conversion";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import type { Prisma } from "@prisma/client";
import type { BomInput } from "./bom.schema";
import { BomRepository } from "./bom.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listStylesWithBom(companyId: string, query: ListQuery) {
  const where: Prisma.ProductWhereInput = {
    companyId,
    itemType: "STYLE",
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { styleName: { contains: query.search, mode: "insensitive" as const } },
            { styleCode: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, totalCount] = await Promise.all([
    BomRepository.findStylesWithBomStatus(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    BomRepository.countStyles(where),
  ]);

  // Deliberately a narrow DTO, not the full Product row — DataTable
  // auto-renders an Active/Inactive toggle for any row with an `isActive`
  // field, PATCHing `${fetchUrl}/:id/status`, which has no meaning (and no
  // route) here; style activation belongs to Masters -> Products only.
  const data = rows.map((row) => ({
    id: row.id,
    styleName: row.styleName,
    styleCode: row.styleCode,
    // Only the APPROVED version's line count — a draft-in-progress with
    // lines shouldn't read as "this style is ready" on the landing list.
    bomItemCount: row.bom?.approvedVersion?._count.items ?? 0,
  }));
  return { data, totalCount };
}

export async function getBomByProductId(companyId: string, productId: string) {
  const product = await ProductRepository.findStyleById(companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  const bom = await BomRepository.findByProductId(companyId, productId);
  return { product, bom };
}

/**
 * Full replace-items upsert — a BOM is a mutable spec, not a versioned
 * document (see the schema comment on the Bom model), so editing it always
 * replaces the whole item list rather than diffing individual lines.
 */
export async function upsertBom(actor: ActorContext, productId: string, input: BomInput) {
  // Tenant-scope check on the Style itself — do not skip this the way it
  // was skipped once already this project (Sampling's addSampleMaterial,
  // then 26 more update* functions — see CLAUDE.md's 2026-08-19 notes).
  const product = await ProductRepository.findStyleById(actor.companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  // Duplicate/overlap validation: two lines for the same (materialId,
  // colorId) pair, or a "applies to every color" (colorId: null) line
  // coexisting with a specific-color line for the same material — both
  // would silently double-count that material/color's consumption in the
  // MRP calculation.
  const seenByMaterial = new Map<string, { hasNullColor: boolean; colorIds: Set<string> }>();
  for (const item of input.items) {
    const colorId = item.colorId || null;
    const entry = seenByMaterial.get(item.materialId) ?? { hasNullColor: false, colorIds: new Set<string>() };

    if (colorId === null) {
      // Two distinct conflicts, two distinct messages — previously both hit
      // the "all-colors + specific-color" message even when no specific-
      // color line was involved at all, which described a conflict that
      // hadn't actually happened for the genuine "two all-colors lines"
      // case (ERP-BUG-Q3, Phase 10 QA pass).
      if (entry.hasNullColor) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "This material already has an \"applies to every color\" line — edit the existing line's quantity instead.",
          { materialId: item.materialId }
        );
      }
      if (entry.colorIds.size > 0) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A material can't have both an \"applies to every color\" line and a specific-color line — they'd double-count that color's consumption.",
          { materialId: item.materialId }
        );
      }
      entry.hasNullColor = true;
    } else {
      if (entry.hasNullColor) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "A material can't have both an \"applies to every color\" line and a specific-color line — they'd double-count that color's consumption.",
          { materialId: item.materialId }
        );
      }
      if (entry.colorIds.has(colorId)) {
        throw new BusinessRuleError(
          "VALIDATION_ERROR",
          "This material already has a line for this color — edit the existing line's quantity instead.",
          { materialId: item.materialId, colorId }
        );
      }
      entry.colorIds.add(colorId);
    }
    seenByMaterial.set(item.materialId, entry);
  }

  // Per-item validation: material exists in this company, is a raw
  // material, has a base UOM configured, and the chosen uomId actually
  // converts to it; color (if given) belongs to this company.
  const preparedItems = [];
  for (const item of input.items) {
    const material = await ProductRepository.findMaterialById(actor.companyId, item.materialId);
    if (!material) throw new BusinessRuleError("NOT_FOUND", "Raw material not found.", { id: item.materialId });

    if (!material.baseUom) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${material.styleName}" has no base unit configured — set one in Masters → Materials first.`,
        { materialId: item.materialId }
      );
    }

    const uom = await LookupRepository.unit.findUnique({ where: { id: item.uomId } });
    if (!uom) throw new BusinessRuleError("NOT_FOUND", "Unit not found.", { id: item.uomId });

    if (convertUomQuantity(1, uom, material.baseUom) === null) {
      throw new BusinessRuleError(
        "VALIDATION_ERROR",
        `"${uom.name}" has no fixed conversion to "${material.styleName}"'s base unit ("${material.baseUom.name}").`,
        { materialId: item.materialId, uomId: item.uomId }
      );
    }

    if (item.colorId) {
      const color = await LookupRepository.color.findFirst({ where: { id: item.colorId, companyId: actor.companyId } });
      if (!color) throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id: item.colorId });
    }

    preparedItems.push({
      materialId: item.materialId,
      colorId: item.colorId || null,
      quantityPerUnit: item.quantityPerUnit,
      wastagePercentage: item.wastagePercentage,
      uomId: item.uomId,
      notes: item.notes || null,
    });
  }

  const before = await BomRepository.findByProductId(actor.companyId, productId);
  const beforeCurrentVersion = before?.versions.find((v) => v.versionNumber === before.currentVersionNumber);

  const updated = await BomRepository.saveDraftWithItems(actor.companyId, productId, actor.userId, input.notes || null, preparedItems);
  const updatedCurrentVersion = updated.versions.find((v) => v.versionNumber === updated.currentVersionNumber)!;

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "bom_versions",
    recordId: updatedCurrentVersion.id,
    action: before ? "UPDATE" : "CREATE",
    oldValues: beforeCurrentVersion ? { versionNumber: beforeCurrentVersion.versionNumber, itemCount: beforeCurrentVersion.items.length } : null,
    newValues: { versionNumber: updatedCurrentVersion.versionNumber, itemCount: updatedCurrentVersion.items.length },
  });

  return updated;
}

/**
 * Approves the style's current DRAFT BOM version — the real gate MRP/
 * Production consume via `Bom.approvedVersionId` (see
 * BomRepository.findManyByProductIds). Self-approval-guarded like every
 * other approval checkpoint in this app. Requires the draft to actually
 * have material lines — an empty approved BOM would silently tell MRP/
 * Production "this style needs nothing," which is worse than having no
 * approved BOM at all (that case is already honestly flagged as
 * `stylesWithoutBom` in mrp.service.ts).
 */
export async function approveBomVersion(actor: ActorContext, productId: string) {
  const product = await ProductRepository.findStyleById(actor.companyId, productId);
  if (!product) throw new BusinessRuleError("NOT_FOUND", "Style not found.", { id: productId });

  const bom = await BomRepository.findByProductId(actor.companyId, productId);
  if (!bom || bom.currentVersionNumber === 0) {
    throw new BusinessRuleError("NOT_FOUND", "This style has no BOM version to approve yet.", { id: productId });
  }

  const currentVersion = bom.versions.find((v) => v.versionNumber === bom.currentVersionNumber)!;
  if (currentVersion.status !== "DRAFT") {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `Version ${currentVersion.versionNumber} is already ${currentVersion.status.toLowerCase()} — nothing to approve. Edit the BOM to start a new version.`,
      {}
    );
  }
  if (currentVersion.items.length === 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Cannot approve a BOM version with no material lines.", {});
  }

  await PermissionService.assert(actor.userId, "bom_mrp", "approve", { createdBy: currentVersion.createdByUserId });

  const updated = await BomRepository.approveVersionInTx(bom.id, currentVersion.id, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "bom_versions",
    recordId: currentVersion.id,
    action: "APPROVE",
    oldValues: { status: "DRAFT" },
    newValues: { status: "APPROVED", versionNumber: currentVersion.versionNumber },
  });

  return updated;
}

import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { MATERIAL_CATEGORIES } from "@/modules/products/product.schema";
import { ProductRepository } from "@/modules/products/product.repository";
import { SupplierRepository } from "./supplier.repository";
import { SupplierMaterialRepository, SupplierMaterialCategoryRepository } from "./supplier-material.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

async function assertSupplierBelongsToCompany(companyId: string, supplierId: string) {
  const supplier = await SupplierRepository.findById(companyId, supplierId);
  if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: supplierId });
  return supplier;
}

export async function listSuppliedMaterials(companyId: string, supplierId: string) {
  await assertSupplierBelongsToCompany(companyId, supplierId);
  return SupplierMaterialRepository.findMany(supplierId);
}

/**
 * Adding a material this supplier can supply. Deliberately separate from —
 * and never writes to — Product.defaultSupplierId, which stays whatever it
 * already was (see the schema comment on SupplierMaterial for why the two
 * are intentionally independent).
 */
export async function addSuppliedMaterial(actor: ActorContext, supplierId: string, materialId: string) {
  await assertSupplierBelongsToCompany(actor.companyId, supplierId);

  // Tenant-scoped and RAW_MATERIAL-only — the same findMaterialById() every
  // other material cross-reference in this codebase (BOM, PO, Material
  // Request) already uses.
  const material = await ProductRepository.findMaterialById(actor.companyId, materialId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Material not found.", { id: materialId });

  const existing = await SupplierMaterialRepository.findLink(supplierId, materialId);
  if (existing) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This material is already linked to this supplier.", {
      supplierId,
      materialId,
    });
  }

  const link = await SupplierMaterialRepository.create({ companyId: actor.companyId, supplierId, productId: materialId });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "supplier_materials",
    recordId: link.id,
    action: "CREATE",
    newValues: { supplierId, materialId },
  });

  return link;
}

/**
 * Bulk add — the "Add Selected (N)" multi-checkbox flow, replacing what
 * would otherwise be N repeated search->select->Add round trips for a
 * supplier that legitimately supplies many materials (the ordinary case,
 * not an edge case; see the schema comment on SupplierMaterial). Forgiving
 * by design: a materialId already linked is silently skipped rather than
 * erroring the whole batch (skipDuplicates at the DB level) — a user
 * re-selecting an already-linked material from the list shouldn't block
 * the rest of their selection.
 */
export async function addSuppliedMaterials(actor: ActorContext, supplierId: string, materialIds: string[]) {
  await assertSupplierBelongsToCompany(actor.companyId, supplierId);

  const uniqueIds = [...new Set(materialIds)];
  const validMaterials = await SupplierMaterialRepository.findManyByProductIds(actor.companyId, uniqueIds);
  const validIds = new Set(validMaterials.map((m) => m.id));
  const invalidIds = uniqueIds.filter((id) => !validIds.has(id));
  if (invalidIds.length > 0) {
    throw new BusinessRuleError("NOT_FOUND", `Unknown or non-material id(s): ${invalidIds.join(", ")}`, { invalidIds });
  }

  await SupplierMaterialRepository.createMany(
    uniqueIds.map((productId) => ({ companyId: actor.companyId, supplierId, productId }))
  );

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "supplier_materials",
    recordId: supplierId,
    action: "CREATE",
    newValues: { supplierId, materialIds: uniqueIds },
  });

  return SupplierMaterialRepository.findMany(supplierId);
}

/**
 * The coarse "this supplier supplies this whole category" catalog — see the
 * schema comment on SupplierMaterialCategory for why this exists alongside,
 * not instead of, the specific-material catalog above. Returns every real
 * material category (the same 7-value list Product.materialCategory itself
 * is validated against — SERVICES/MACHINERY are Supplier-only concepts, no
 * Product ever carries those, so linking a supplier to them here would be
 * meaningless) with a `granted` flag, matching getRoleProductionStageAccess's
 * own shape.
 */
export async function listSuppliedCategories(companyId: string, supplierId: string) {
  await assertSupplierBelongsToCompany(companyId, supplierId);
  const granted = await SupplierMaterialCategoryRepository.findGranted(supplierId);
  const grantedSet = new Set(granted.map((g) => g.materialCategory));
  return MATERIAL_CATEGORIES.map((category) => ({ category, granted: grantedSet.has(category) }));
}

export async function updateSuppliedCategories(actor: ActorContext, supplierId: string, categories: string[]) {
  await assertSupplierBelongsToCompany(actor.companyId, supplierId);

  const invalid = categories.filter((c) => !MATERIAL_CATEGORIES.includes(c as never));
  if (invalid.length > 0) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unknown material category value(s): ${invalid.join(", ")}`, { invalid });
  }

  await SupplierMaterialCategoryRepository.replaceInTx(actor.companyId, supplierId, [...new Set(categories)]);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "supplier_material_categories",
    recordId: supplierId,
    action: "UPDATE",
    newValues: { supplierId, categories },
  });

  return listSuppliedCategories(actor.companyId, supplierId);
}

export async function removeSuppliedMaterial(actor: ActorContext, supplierId: string, materialId: string) {
  await assertSupplierBelongsToCompany(actor.companyId, supplierId);

  const existing = await SupplierMaterialRepository.findLink(supplierId, materialId);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "This material is not linked to this supplier.", { supplierId, materialId });

  await SupplierMaterialRepository.delete(existing.id);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "supplier_materials",
    recordId: existing.id,
    action: "DELETE",
    oldValues: { supplierId, materialId },
  });
}

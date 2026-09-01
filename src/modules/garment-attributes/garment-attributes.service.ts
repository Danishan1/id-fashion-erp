import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { GarmentAttributeRepository } from "./garment-attributes.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

interface CodeNameInput {
  code: string;
  name: string;
  isActive: boolean;
}

interface LookupRecord {
  id: string;
  [key: string]: unknown;
}

interface SimpleLookupDelegate {
  findMany(args: { where: { companyId: string }; orderBy: { name: "asc" } }): Promise<unknown[]>;
  findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null>;
  create(args: { data: CodeNameInput & { companyId: string } }): Promise<LookupRecord>;
  update(args: { where: { id: string }; data: CodeNameInput }): Promise<LookupRecord>;
}

/**
 * Brand/Category/Season/Fitting/ProductType/Design/DesignPattern/Pattern are all
 * identical {code,name,isActive} lookups under a per-company unique code — one
 * factory avoids 8x duplicated list/create/update triples.
 */
function makeSimpleLookupService(delegate: SimpleLookupDelegate, label: string, tableName: string) {
  return {
    list: (companyId: string) => delegate.findMany({ where: { companyId }, orderBy: { name: "asc" } }),

    create: async (actor: ActorContext, input: CodeNameInput) => {
      const existing = await delegate.findFirst({ where: { companyId: actor.companyId, code: input.code } });
      if (existing) {
        throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `${label} code "${input.code}" is already in use.`);
      }
      const record = await delegate.create({
        data: { companyId: actor.companyId, code: input.code, name: input.name, isActive: input.isActive },
      });

      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName,
        recordId: record.id,
        action: "CREATE",
        newValues: record,
      });

      return record;
    },

    update: async (actor: ActorContext, id: string, input: CodeNameInput) => {
      // Ownership check before mutating — without this, any company's "edit" permission
      // could update another tenant's row by id (found + fixed in a multi-tenant audit).
      const existing = await delegate.findFirst({ where: { id, companyId: actor.companyId } });
      if (!existing) {
        throw new BusinessRuleError("NOT_FOUND", `${label} not found.`, { id });
      }

      const updated = await delegate.update({
        where: { id },
        data: { code: input.code, name: input.name, isActive: input.isActive },
      });

      await writeAuditLog({
        companyId: actor.companyId,
        userId: actor.userId,
        tableName,
        recordId: id,
        action: "UPDATE",
        newValues: updated,
      });

      return updated;
    },
  };
}

const brandOps = makeSimpleLookupService(GarmentAttributeRepository.brand, "Brand", "brands");
export const listBrands = brandOps.list;
export const createBrand = brandOps.create;
export const updateBrand = brandOps.update;

// Category is pulled out of the shared factory (unlike its 8 siblings above) —
// unlimited-depth subcategories need a parentCategoryId field and a cycle
// guard the generic {code,name,isActive} factory has no room for. Kept as
// standalone functions rather than growing the factory's shared input type,
// so Brand/Season/Fitting/ProductType/Design/DesignPattern/Pattern/
// SupplierCategory are completely unaffected.
interface CategoryInput {
  code: string;
  name: string;
  isActive: boolean;
  parentCategoryId?: string | null;
}

const CATEGORY_ANCESTOR_WALK_LIMIT = 50;

/**
 * Validates a category's chosen parent belongs to the same company and would
 * not create a cycle — walks up the candidate parent's own ancestor chain; if
 * that walk ever reaches `categoryId` (the record being saved), the candidate
 * parent is one of this category's own descendants (or itself), which would
 * make it its own ancestor once linked. `categoryId` is null on create, where
 * no descendants can exist yet, so only the same-company existence check
 * applies there.
 */
async function assertValidParentCategory(companyId: string, categoryId: string | null, parentCategoryId: string | null) {
  if (!parentCategoryId) return;
  if (parentCategoryId === categoryId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "A category cannot be its own parent.");
  }

  let currentId: string | null = parentCategoryId;
  for (let hops = 0; currentId; hops++) {
    if (hops >= CATEGORY_ANCESTOR_WALK_LIMIT) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Category hierarchy is too deep to validate.");
    }
    const current: { id: string; parentCategoryId: string | null } | null = await GarmentAttributeRepository.category.findFirst({
      where: { id: currentId, companyId },
      select: { id: true, parentCategoryId: true },
    });
    if (!current) {
      throw new BusinessRuleError("NOT_FOUND", "Parent category not found.", { id: parentCategoryId });
    }
    if (categoryId && current.id === categoryId) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Cannot set a category's parent to one of its own descendants.");
    }
    currentId = current.parentCategoryId;
  }
}

export const listCategories = (companyId: string) =>
  GarmentAttributeRepository.category.findMany({ where: { companyId }, orderBy: { name: "asc" } });

export async function createCategory(actor: ActorContext, input: CategoryInput) {
  const existing = await GarmentAttributeRepository.category.findFirst({
    where: { companyId: actor.companyId, code: input.code },
  });
  if (existing) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Category code "${input.code}" is already in use.`);
  }
  await assertValidParentCategory(actor.companyId, null, input.parentCategoryId ?? null);

  const record = await GarmentAttributeRepository.category.create({
    data: {
      companyId: actor.companyId,
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      parentCategoryId: input.parentCategoryId || null,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "categories",
    recordId: record.id,
    action: "CREATE",
    newValues: record,
  });

  return record;
}

export async function updateCategory(actor: ActorContext, id: string, input: CategoryInput) {
  const existing = await GarmentAttributeRepository.category.findFirst({ where: { id, companyId: actor.companyId } });
  if (!existing) {
    throw new BusinessRuleError("NOT_FOUND", "Category not found.", { id });
  }
  await assertValidParentCategory(actor.companyId, id, input.parentCategoryId ?? null);

  const updated = await GarmentAttributeRepository.category.update({
    where: { id },
    data: {
      code: input.code,
      name: input.name,
      isActive: input.isActive,
      parentCategoryId: input.parentCategoryId || null,
    },
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "categories",
    recordId: id,
    action: "UPDATE",
    newValues: updated,
  });

  return updated;
}

const seasonOps = makeSimpleLookupService(GarmentAttributeRepository.season, "Season", "seasons");
export const listSeasons = seasonOps.list;
export const createSeason = seasonOps.create;
export const updateSeason = seasonOps.update;

const productFittingOps = makeSimpleLookupService(GarmentAttributeRepository.productFitting, "Fitting", "product_fittings");
export const listProductFittings = productFittingOps.list;
export const createProductFitting = productFittingOps.create;
export const updateProductFitting = productFittingOps.update;

const productTypeOps = makeSimpleLookupService(GarmentAttributeRepository.productType, "Product type", "product_types");
export const listProductTypes = productTypeOps.list;
export const createProductType = productTypeOps.create;
export const updateProductType = productTypeOps.update;

const designOps = makeSimpleLookupService(GarmentAttributeRepository.design, "Design", "designs");
export const listDesigns = designOps.list;
export const createDesign = designOps.create;
export const updateDesign = designOps.update;

const designPatternOps = makeSimpleLookupService(GarmentAttributeRepository.designPattern, "Design pattern", "design_patterns");
export const listDesignPatterns = designPatternOps.list;
export const createDesignPattern = designPatternOps.create;
export const updateDesignPattern = designPatternOps.update;

const patternOps = makeSimpleLookupService(GarmentAttributeRepository.pattern, "Pattern", "patterns");
export const listPatterns = patternOps.list;
export const createPattern = patternOps.create;
export const updatePattern = patternOps.update;

const supplierCategoryOps = makeSimpleLookupService(GarmentAttributeRepository.supplierCategory, "Supplier category", "supplier_categories");
export const listSupplierCategories = supplierCategoryOps.list;
export const createSupplierCategory = supplierCategoryOps.create;
export const updateSupplierCategory = supplierCategoryOps.update;

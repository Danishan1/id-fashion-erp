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

const categoryOps = makeSimpleLookupService(GarmentAttributeRepository.category, "Category", "categories");
export const listCategories = categoryOps.list;
export const createCategory = categoryOps.create;
export const updateCategory = categoryOps.update;

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

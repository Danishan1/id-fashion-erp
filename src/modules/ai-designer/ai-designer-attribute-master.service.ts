import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { getDesignAttributesForCategory, type DesignAttributeDef } from "@/core/ai-designer/catalogs/design-attribute-catalog";
import { AiDesignerProductDesignAttributeRepository } from "./ai-designer.repository";
import type { CreateProductDesignAttributeInput, UpdateProductDesignAttributeInput } from "./ai-designer-attribute-master.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function listProductDesignAttributes(companyId: string) {
  return AiDesignerProductDesignAttributeRepository.findMany(companyId);
}

export async function createProductDesignAttribute(actor: ActorContext, input: CreateProductDesignAttributeInput) {
  const existing = await AiDesignerProductDesignAttributeRepository.findByKey(actor.companyId, input.categoryName, input.attributeKey);
  if (existing) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `"${input.attributeKey}" already exists for category "${input.categoryName}" — edit that one instead.`
    );
  }

  const attribute = await AiDesignerProductDesignAttributeRepository.create({
    companyId: actor.companyId,
    categoryName: input.categoryName,
    attributeKey: input.attributeKey,
    attributeLabel: input.attributeLabel,
    options: input.options,
    sortOrder: input.sortOrder,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_product_design_attributes",
    recordId: attribute.id,
    action: "CREATE",
    newValues: { categoryName: input.categoryName, attributeKey: input.attributeKey, options: input.options },
  });

  return attribute;
}

export async function updateProductDesignAttribute(actor: ActorContext, id: string, input: UpdateProductDesignAttributeInput) {
  const existing = await AiDesignerProductDesignAttributeRepository.findAnyById(actor.companyId, id);
  if (!existing) throw new BusinessRuleError("NOT_FOUND", "Product Design attribute not found.", { id });

  const updated = await AiDesignerProductDesignAttributeRepository.update(id, input);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_product_design_attributes",
    recordId: id,
    action: "UPDATE",
    oldValues: { attributeLabel: existing.attributeLabel, options: existing.options, isActive: existing.isActive },
    newValues: input,
  });

  return updated;
}

/**
 * Used by the wizard's own Product Design step (via a real API route, not a
 * static import) — this company's own real rows for the category once ANY
 * exist, otherwise the original hardcoded default. See the schema comment
 * on AiDesignerProductDesignAttribute for the "DB overrides the static
 * default per category, not a merge" reasoning.
 */
export async function getEffectiveDesignAttributesForCategory(companyId: string, categoryName: string): Promise<DesignAttributeDef[]> {
  const rows = await AiDesignerProductDesignAttributeRepository.findActiveByCategory(companyId, categoryName);
  if (rows.length > 0) {
    return rows.map((r) => ({ key: r.attributeKey, label: r.attributeLabel, options: r.options }));
  }
  return getDesignAttributesForCategory(categoryName);
}

import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { logger } from "@/core/logging/logger";
import { deleteAttachment, uploadAttachment } from "@/core/attachments/AttachmentService";
import {
  getDesignAttributesForCategory,
  PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY,
  type DesignAttributeDef,
} from "@/core/ai-designer/catalogs/design-attribute-catalog";
import { toReferenceImageThumbnail } from "@/core/ai-designer/catalogs/reference-image-thumbnail";
import { buildOptionFlatPrompt, listSketchStructureOptions } from "@/core/ai-designer/catalogs/sketch-structure-catalog";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import {
  AiDesignerProductDesignAttributeRepository,
  AiDesignerOptionReferenceImageRepository,
  type OptionImageVariant,
} from "./ai-designer.repository";
import type { CreateProductDesignAttributeInput, UpdateProductDesignAttributeInput } from "./ai-designer-attribute-master.schema";

interface ActorContext {
  companyId: string;
  userId: string;
}

interface UploadableFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

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

// ---------------------------------------------------------------------------
// Reference photo overrides — a real, admin-uploadable photo per option
// VALUE (e.g. "Deep Back Cut-Out"), superseding the AI-generated static
// photo without needing an image-generation provider at all. See the schema
// doc comment on AiDesignerOptionReferenceImage for the "dedupe by value
// only" reasoning shared with the AI-generated pipeline this augments.
// ---------------------------------------------------------------------------

/**
 * Every option value this company could possibly need a reference photo
 * for — the built-in catalog (every category, whether or not this company
 * has customized it) UNION this company's own customized attribute rows
 * (which may include option values the built-in catalog never had). Deduped
 * case-insensitively, first-wins, alphabetical — mirrors the reference-image
 * generation script's own `collectDistinctValues()`, just company-aware.
 */
export async function listAllKnownOptionValues(companyId: string): Promise<string[]> {
  const seen = new Map<string, string>(); // lowercase -> original value (first one wins)
  const consider = (value: string) => {
    const key = value.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, value.trim());
  };

  for (const attrs of Object.values(PRODUCT_DESIGN_ATTRIBUTES_BY_CATEGORY)) {
    for (const attr of attrs) {
      for (const opt of attr.options) consider(opt);
    }
  }

  const customRows = await AiDesignerProductDesignAttributeRepository.findMany(companyId);
  for (const row of customRows) {
    for (const opt of row.options) consider(opt);
  }

  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** { optionValue -> attachmentId } for every option value this company has actually uploaded an override photo for. */
export async function listOptionReferenceImages(companyId: string, variant: OptionImageVariant = "PHOTO"): Promise<Record<string, string>> {
  const rows = await AiDesignerOptionReferenceImageRepository.findMany(companyId, variant);
  return Object.fromEntries(rows.map((r) => [r.optionValue, r.attachmentId]));
}

export async function uploadOptionReferenceImage(
  actor: ActorContext,
  optionValue: string,
  file: UploadableFile,
  variant: OptionImageVariant = "PHOTO"
) {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }
  return storeOptionImage(actor, optionValue, file, variant);
}

async function storeOptionImage(actor: ActorContext, optionValue: string, file: UploadableFile, variant: OptionImageVariant) {
  const existing = await AiDesignerOptionReferenceImageRepository.findByValue(actor.companyId, optionValue, variant);

  // Attachment.relatedRecordId is @db.Uuid — the raw optionValue string isn't
  // a real record id, so a fresh one is minted up front for a brand-new
  // override (reusing the existing row's own real id when replacing).
  const relatedRecordId = existing?.id ?? crypto.randomUUID();
  // A phone-camera upload can be several MB; this is only ever shown as an
  // ~80px thumbnail (same reasoning as the AI-generated pipeline's own
  // toReferenceImageThumbnail() — reused here, not reimplemented, so both
  // paths produce identically-sized files).
  const thumbnailBuffer = await toReferenceImageThumbnail(file.buffer);
  const attachment = await uploadAttachment(
    actor,
    "AI_DESIGNER_PROJECT",
    relatedRecordId,
    { buffer: thumbnailBuffer, fileName: file.fileName.replace(/\.[^.]+$/, ".jpg"), mimeType: "image/jpeg" },
    "OPTION_REFERENCE_IMAGE"
  );
  const row = await AiDesignerOptionReferenceImageRepository.upsert({
    companyId: actor.companyId,
    optionValue,
    attachmentId: attachment.id,
    createdByUserId: actor.userId,
    variant,
  });

  // Replacing an existing override — clean up the old file, but a transient
  // failure here must never block the new photo from taking effect (same
  // "log, don't block" precedent already used for AI Garment Flow's own
  // replace-image cleanup).
  if (existing && existing.attachmentId !== attachment.id) {
    try {
      await deleteAttachment(actor, existing.attachmentId);
    } catch (err) {
      logger.error("Failed to delete replaced option reference image attachment", { attachmentId: existing.attachmentId, err });
    }
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_designer_option_reference_images",
    recordId: row.id,
    action: existing ? "UPDATE" : "CREATE",
    newValues: { optionValue, variant, attachmentId: attachment.id },
  });

  return row;
}

export async function deleteOptionReferenceImage(actor: ActorContext, optionValue: string, variant: OptionImageVariant = "PHOTO") {
  const existing = await AiDesignerOptionReferenceImageRepository.findByValue(actor.companyId, optionValue, variant);
  if (!existing) {
    throw new BusinessRuleError("NOT_FOUND", `No uploaded photo override exists for "${optionValue}".`, { optionValue });
  }

  await AiDesignerOptionReferenceImageRepository.deleteByValue(actor.companyId, optionValue, variant);
  await deleteAttachment(actor, existing.attachmentId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_designer_option_reference_images",
    recordId: existing.id,
    action: "DELETE",
    oldValues: { optionValue, variant, attachmentId: existing.attachmentId },
  });
}

// ---------------------------------------------------------------------------
// Construction option CAD flats — the small line-drawing photo on each
// edit-page construction option (A-Line, V-Neck, ...). Generated a few at a
// time so each request stays short; the Masters page calls this repeatedly
// until `remaining` reaches 0. Admins can still upload/replace any of them.
// ---------------------------------------------------------------------------

export const OPTION_FLAT_BATCH_LIMIT = 6;

export async function generateMissingOptionFlats(actor: ActorContext, input: { limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? OPTION_FLAT_BATCH_LIMIT, 1), OPTION_FLAT_BATCH_LIMIT);
  const existing = await listOptionReferenceImages(actor.companyId, "CAD_FLAT");
  const missing = listSketchStructureOptions().filter((o) => !existing[o.value]);
  const batch = missing.slice(0, limit);

  const generated: string[] = [];
  const failed: { value: string; error: string }[] = [];
  for (const option of batch) {
    try {
      const result = await runWithFailover({
        companyId: actor.companyId,
        userId: actor.userId,
        capability: "TEXT_TO_IMAGE",
        generationContext: `AI Designer / Construction option flat "${option.value}"`,
        inputImagePresent: false,
        call: (provider) => provider.generate({ prompt: buildOptionFlatPrompt(option.groupLabel, option.value), count: 1 }),
      });
      const image = result.images[0];
      if (!image) throw new Error("The provider returned no image.");
      await storeOptionImage(
        actor,
        option.value,
        { buffer: image.buffer, fileName: `option-flat-${Date.now()}.png`, mimeType: image.mimeType },
        "CAD_FLAT"
      );
      generated.push(option.value);
    } catch (err) {
      failed.push({ value: option.value, error: err instanceof Error ? err.message : "Generation failed." });
    }
  }

  // Every attempt in a batch failing almost always means the provider itself is down/out of credit — say so.
  if (batch.length > 0 && generated.length === 0) {
    throw new BusinessRuleError("AI_SERVICE_ERROR", failed[0]?.error ?? "Construction photo generation failed.", { failed });
  }
  const total = listSketchStructureOptions().length;
  return { generated, failed, remaining: missing.length - generated.length, total };
}

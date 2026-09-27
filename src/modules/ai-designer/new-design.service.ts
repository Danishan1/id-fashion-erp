import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type AiDesignerDesignSource, type AiDesignerProject } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { previewNextMasterCode } from "@/core/numbering/DocumentNumberingService";
import { AiConfigMissingError, getAiTextProvider } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { hasProviderForCapability, runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { analyzeGarment, PROMPT_VERSION as GARMENT_PROMPT_VERSION } from "@/core/ai-designer/garment-analysis/analyze";
import type { GarmentAnalysisResponse } from "@/core/ai-designer/garment-analysis/schema";
import {
  buildColorVariantPrompt,
  buildTemplateDressSwapPrompt,
  NEW_DESIGN_PROMPT_VERSION,
} from "@/core/ai-designer/image-generation/new-design-prompt";
import {
  getGarmentTemplate,
  rankGarmentTemplates,
  templatePublicPath,
  type GarmentSuggestion,
} from "@/core/ai-designer/catalogs/garment-template-catalog";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";
import { TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { ProductRepository } from "@/modules/products/product.repository";
import { createMaterial, setProductMainImage } from "@/modules/products/product.service";
import {
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
} from "./ai-designer.repository";
import {
  bumpVersion,
  createProject,
  generateDesign,
  getProjectById,
  runFabricAnalysis,
  selectExistingFabric,
  uploadFabricImage,
} from "./ai-designer.service";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface UploadableFile {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;
export const STUDIO_ENVIRONMENT_KEY = "STUDIO_WHITE";

function assertImage(file: UploadableFile) {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }
}

function toMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/webp") return "image/webp";
  throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported image type "${mimeType}".`);
}

async function getOwnedNewDesignProject(companyId: string, id: string) {
  const project = await AiDesignerProjectRepository.findAnyById(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id });
  if (!project.designSource) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project was created with the classic wizard — open it there instead.");
  }
  return project;
}

async function assertNoActiveRun(projectId: string, promptType: "GARMENT_ANALYSIS" | "IMAGE_GENERATE" | "COLOR_VARIANT") {
  const active = await AiDesignerPromptRepository.findActiveSince(projectId, promptType, new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS));
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An AI request is already in progress for this design.", { promptId: active.id });
  }
}

// ---------------------------------------------------------------------------
// Create / get
// ---------------------------------------------------------------------------

export async function createNewDesignProject(actor: ActorContext, input: { designSource: AiDesignerDesignSource; projectName?: string }) {
  const label = input.designSource === "FABRIC" ? "Fabric" : input.designSource === "GARMENT" ? "Garment" : "Sketch";
  const project = await createProject(actor, {
    projectName: input.projectName?.trim() || `New Design — from ${label}`,
    creationMode: "STANDARD",
    projectMode: "SINGLE",
  });
  return AiDesignerProjectRepository.update(project.id, {
    designSource: input.designSource,
    newDesignStep: "SOURCE",
    // Studio is the default environment for every new design.
    environmentKey: STUDIO_ENVIRONMENT_KEY,
    environmentLabel: getEnvironmentByKey(STUDIO_ENVIRONMENT_KEY)?.label ?? "Studio White",
    isCustomEnvironment: false,
  });
}

export async function setNewDesignStep(actor: ActorContext, projectId: string, step: "SOURCE" | "GARMENT" | "GENERATE" | "DESIGNS") {
  await getOwnedNewDesignProject(actor.companyId, projectId);
  return AiDesignerProjectRepository.update(projectId, { newDesignStep: step });
}

// ---------------------------------------------------------------------------
// Step 1 — source upload + analysis
// ---------------------------------------------------------------------------

export async function uploadSourceImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  const project = await getOwnedNewDesignProject(actor.companyId, projectId);
  assertImage(file);

  if (project.designSource === "FABRIC") {
    await uploadFabricImage(actor, projectId, file);
  } else {
    const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, `${project.designSource}_SOURCE_IMAGE`);
    await AiDesignerProjectRepository.update(projectId, {
      sourceImageAttachmentId: attachment.id,
      sourceAnalysisJson: Prisma.DbNull,
      garmentSuggestionsJson: Prisma.DbNull,
    });
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_projects",
      recordId: projectId,
      action: "UPDATE",
      newValues: { sourceImageAttachmentId: attachment.id },
    });
  }
  return getProjectById(actor.companyId, projectId);
}

/**
 * Picks the top suggestion and writes it onto the project (garmentTemplateKey
 * + the matching customer/age/category, so the classic fallback generation
 * path always has what it needs).
 */
async function applySuggestions(projectId: string, suggestions: GarmentSuggestion[]) {
  const top = suggestions[0] ? getGarmentTemplate(suggestions[0].key) : undefined;
  await AiDesignerProjectRepository.update(projectId, {
    garmentSuggestionsJson: suggestions as unknown as Prisma.InputJsonValue,
    ...(top
      ? {
          garmentTemplateKey: top.key,
          targetCustomer: top.customer,
          ageGroup: top.defaultAgeGroup,
          productCategory: top.category,
          customTemplateAttachmentId: null,
        }
      : {}),
  });
}

export async function analyzeSource(actor: ActorContext, projectId: string) {
  const project = await getOwnedNewDesignProject(actor.companyId, projectId);

  if (project.designSource === "FABRIC") {
    const analysed = await runFabricAnalysis(actor, projectId);
    await applySuggestions(
      projectId,
      rankGarmentTemplates({ primary: null, secondary: analysed?.fabricRecommendedGarments ?? null })
    );
    await autoCreateFabricMaster(actor, projectId);
    return getProjectById(actor.companyId, projectId);
  }

  if (!project.sourceImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a garment photo or sketch before running the analysis.");
  }
  await assertNoActiveRun(projectId, "GARMENT_ANALYSIS");

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.sourceImageAttachmentId);
  const isSketch = project.designSource === "SKETCH";
  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "GARMENT_ANALYSIS",
    promptVersion: GARMENT_PROMPT_VERSION,
    specJson: { designSource: project.designSource },
    promptText: isSketch ? "Analyse sketch" : "Analyse garment photo",
    provider: getAiTextProvider(),
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeGarment({ imageBuffer: buffer, imageMediaType: toMediaType(attachment.mimeType), isSketch });
    await AiDesignerProjectRepository.update(projectId, {
      sourceAnalysisJson: result.data as unknown as Prisma.InputJsonValue,
    });
    await applySuggestions(projectId, rankGarmentTemplates({ primary: result.data.garmentType, secondary: result.data.suggestedGarments }));
    await AiDesignerPromptRepository.markSuccess(promptRow.id);
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_prompts",
      recordId: promptRow.id,
      action: "CREATE",
      newValues: { promptType: "GARMENT_ANALYSIS", status: "SUCCESS" },
    });
    return getProjectById(actor.companyId, projectId);
  } catch (err) {
    const category =
      err instanceof AiConfigMissingError
        ? "MISSING_CONFIG"
        : err instanceof AiServiceError
          ? err.category
          : err instanceof AiInvalidResponseError
            ? "NO_STRUCTURED_RESPONSE"
            : "UNKNOWN";
    await AiDesignerPromptRepository.markFailed(promptRow.id, category, err instanceof Error ? err.message : "Unknown error.");
    if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
      throw new BusinessRuleError("AI_SERVICE_ERROR", err.message);
    }
    throw err;
  }
}

export async function updateSourceAnalysisField(actor: ActorContext, projectId: string, field: keyof GarmentAnalysisResponse, value: string) {
  const project = await getOwnedNewDesignProject(actor.companyId, projectId);
  const current = (project.sourceAnalysisJson as Record<string, string> | null) ?? {};
  await AiDesignerProjectRepository.update(projectId, {
    sourceAnalysisJson: { ...current, [field]: value } as Prisma.InputJsonValue,
  });
  return getProjectById(actor.companyId, projectId);
}

/**
 * Fabric source only: once the fabric is analysed, register it in the real
 * Fabric Master (a RAW_MATERIAL / FABRIC Product) with the uploaded photo as
 * its main image, and link it back via fabricProductId. Links to an existing
 * same-named fabric instead of duplicating it. Skipped silently (never
 * blocks the design) when the user may not create masters, or when the
 * project is already linked to a fabric.
 */
export async function autoCreateFabricMaster(actor: ActorContext, projectId: string): Promise<{ productId: string | null; created: boolean }> {
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project || project.fabricProductId || !project.fabricImageAttachmentId || !project.fabricName) {
    return { productId: project?.fabricProductId ?? null, created: false };
  }
  const allowed = await PermissionService.can(actor.userId, "masters_core", "create");
  if (!allowed) return { productId: null, created: false };

  const name = project.fabricName.trim().slice(0, 200);
  const existing = await ProductRepository.findMaterialByName(actor.companyId, name);
  if (existing) {
    await selectExistingFabric(actor, projectId, { fabricProductId: existing.id });
    return { productId: existing.id, created: false };
  }

  const description = [
    project.fabricComposition && `Composition: ${project.fabricComposition}`,
    project.fabricGsm && `GSM: ${project.fabricGsm}`,
    project.fabricWidth && `Width: ${project.fabricWidth}`,
    project.fabricWeave && `Weave: ${project.fabricWeave}`,
    project.fabricPatternType && `Pattern: ${project.fabricPatternType}`,
    `Created from AI Designer ${project.projectNumber}.`,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1000);

  const styleCode = await previewNextMasterCode(actor.companyId, "MATERIAL");
  const material = await createMaterial(actor, {
    styleCode,
    styleName: name,
    materialCategory: "FABRIC",
    description,
    isActive: true,
  } as Parameters<typeof createMaterial>[1]);

  // Copy the fabric photo into the Product's own gallery and make it the main image.
  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId);
  const productAttachment = await uploadAttachment(
    actor,
    "PRODUCT",
    material.id,
    { buffer, fileName: attachment.fileName || `${styleCode}.png`, mimeType: attachment.mimeType },
    "FABRIC_IMAGE"
  );
  await setProductMainImage(actor, material.id, productAttachment.id);
  await selectExistingFabric(actor, projectId, { fabricProductId: material.id });
  return { productId: material.id, created: true };
}

// ---------------------------------------------------------------------------
// Fabric suggestions from the company's own Fabric Master (GARMENT/SKETCH)
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "with", "for", "soft", "likely", "fabric", "visible", "not"].includes(w));
}

export function scoreFabricMatch(fabricText: string, hints: string[]): number {
  const haystack = fabricText.toLowerCase();
  let score = 0;
  for (const h of new Set(hints)) if (haystack.includes(h)) score += 1;
  return score;
}

export async function suggestFabricsFromDatabase(actor: ActorContext, projectId: string) {
  const project = await getOwnedNewDesignProject(actor.companyId, projectId);
  const analysis = (project.sourceAnalysisJson as Record<string, string> | null) ?? {};
  const hints = tokenize(`${analysis.fabricDescription ?? ""} ${analysis.printDescription ?? ""} ${analysis.primaryColor ?? ""}`);

  const fabrics = await ProductRepository.findManyMaterials(
    { companyId: actor.companyId, itemType: "RAW_MATERIAL", materialCategory: "FABRIC", deletedAt: null, isActive: true },
    { orderBy: { createdAt: "desc" }, take: 200 }
  );

  return fabrics
    .map((f) => ({
      id: f.id,
      styleName: f.styleName,
      styleCode: f.styleCode,
      description: f.description,
      mainImageUrl: f.mainImageAttachmentId
        ? `/api/v1/products/attachments/${f.mainImageAttachmentId}/download?disposition=inline`
        : null,
      score: scoreFabricMatch(`${f.styleName} ${f.description ?? ""}`, hints) + (f.mainImageAttachmentId ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export async function selectSuggestedFabric(actor: ActorContext, projectId: string, productId: string) {
  await getOwnedNewDesignProject(actor.companyId, projectId);
  const material = await ProductRepository.findMaterialById(actor.companyId, productId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Fabric not found in the Fabric Master.", { id: productId });

  await selectExistingFabric(actor, projectId, { fabricProductId: material.id });

  if (material.mainImageAttachmentId) {
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, material.mainImageAttachmentId);
    await uploadFabricImage(actor, projectId, {
      buffer,
      fileName: attachment.fileName || `${material.styleCode}.png`,
      mimeType: attachment.mimeType,
    });
  }
  return getProjectById(actor.companyId, projectId);
}

// ---------------------------------------------------------------------------
// Step 2 — garment type / template
// ---------------------------------------------------------------------------

export async function selectGarmentTemplate(actor: ActorContext, projectId: string, key: string) {
  await getOwnedNewDesignProject(actor.companyId, projectId);
  const template = getGarmentTemplate(key);
  if (!template) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown garment type "${key}".`);

  await AiDesignerProjectRepository.update(projectId, {
    garmentTemplateKey: template.key,
    targetCustomer: template.customer,
    ageGroup: template.defaultAgeGroup,
    productCategory: template.category,
    customTemplateAttachmentId: null,
  });
  return getProjectById(actor.companyId, projectId);
}

export async function uploadCustomTemplate(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedNewDesignProject(actor.companyId, projectId);
  assertImage(file);
  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "CUSTOM_TEMPLATE_IMAGE");
  await AiDesignerProjectRepository.update(projectId, { customTemplateAttachmentId: attachment.id });
  return getProjectById(actor.companyId, projectId);
}

/** The model photo to dress-swap onto: the user's own upload wins, then the catalog photo, else null (fallback generation). */
export async function loadGarmentTemplateImage(
  companyId: string,
  project: Pick<AiDesignerProject, "customTemplateAttachmentId" | "garmentTemplateKey">
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  if (project.customTemplateAttachmentId) {
    const { attachment, buffer } = await getAttachmentForDownload(companyId, project.customTemplateAttachmentId);
    return { buffer, mimeType: attachment.mimeType };
  }
  const template = project.garmentTemplateKey ? getGarmentTemplate(project.garmentTemplateKey) : undefined;
  const rel = template ? templatePublicPath(template) : null;
  if (!rel) return null;
  try {
    const buffer = await readFile(path.join(process.cwd(), "public", rel));
    return { buffer, mimeType: rel.endsWith(".png") ? "image/png" : "image/jpeg" };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3 — generate
// ---------------------------------------------------------------------------

function buildDesignBrief(project: AiDesignerProject): string | null {
  const a = project.sourceAnalysisJson as Record<string, string> | null;
  if (!a || project.designSource === "FABRIC") return null;
  const parts = [
    a.silhouette && `silhouette ${a.silhouette}`,
    a.neckline && `neckline ${a.neckline}`,
    a.sleeve && `sleeve ${a.sleeve}`,
    a.length && `length ${a.length}`,
    a.fit && `fit ${a.fit}`,
    a.keyDetails && `details ${a.keyDetails}`,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

async function persistImages(
  actor: ActorContext,
  projectId: string,
  generationId: string,
  images: { buffer: Buffer; mimeType: string }[],
  contextLabel: string
) {
  const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
  for (let i = 0; i < images.length; i++) {
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: images[i].buffer, fileName: `ai-designer-${Date.now()}-${i + 1}.png`, mimeType: images[i].mimeType },
      contextLabel
    );
    rows.push({ companyId: actor.companyId, projectId, generationId, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
  }
  await AiDesignerImageRepository.createMany(rows);
  return AiDesignerImageRepository.findByGenerationId(generationId);
}

export async function generateNewDesign(actor: ActorContext, projectId: string, input: { imageCount: 1 | 3 | 4 }) {
  const project = await getOwnedNewDesignProject(actor.companyId, projectId);

  const missing: string[] = [];
  if (!project.fabricImageAttachmentId) missing.push("a fabric photo (upload one, or pick a suggested fabric in Step 1)");
  if (!project.productCategory || !project.targetCustomer) missing.push("a garment type (Step 2)");
  if (missing.length) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Complete the following before generating: ${missing.join(", ")}.`, { missing });
  }

  const template = await loadGarmentTemplateImage(actor.companyId, project);

  // Which two-image capability can this company actually use? Prefer Design
  // Replication; Multi-Fabric (applyFabric — "apply this swatch onto this
  // garment photo") is the same two-image operation under a different admin
  // toggle. With neither ticked on any provider, fall back to the classic
  // fabric-reference generation rather than failing outright.
  const swapCapability = !template
    ? null
    : (await hasProviderForCapability(actor.companyId, "DESIGN_REPLICATION"))
      ? ("DESIGN_REPLICATION" as const)
      : (await hasProviderForCapability(actor.companyId, "MULTI_FABRIC"))
        ? ("MULTI_FABRIC" as const)
        : null;

  if (!template || !swapCapability) {
    // No model photo for this garment type, or no provider enabled for a
    // two-image dress swap — the classic fabric-reference generation.
    const result = await generateDesign(actor, projectId, { imageCount: input.imageCount, viewAngle: "FRONT" });
    await AiDesignerProjectRepository.update(projectId, { newDesignStep: "DESIGNS" });
    return { ...result, usedTemplate: false as const };
  }

  await assertNoActiveRun(projectId, "IMAGE_GENERATE");
  const { attachment: fabricAttachment, buffer: fabricBuffer } = await getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId!);

  const environment = project.environmentKey ? getEnvironmentByKey(project.environmentKey) : undefined;
  const keepTemplateBackground = !project.environmentKey || project.environmentKey === STUDIO_ENVIRONMENT_KEY;
  const prompt = buildTemplateDressSwapPrompt({
    garmentType: project.productCategory!,
    targetCustomer: TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] ?? "Women",
    ageGroup: project.ageGroup || "Adult",
    designBrief: buildDesignBrief(project),
    environmentLabel: project.environmentLabel || "Studio White",
    environmentHint: project.isCustomEnvironment ? project.environmentLabel : environment?.promptHint ?? null,
    keepTemplateBackground,
  });

  const specJson = {
    newDesign: true,
    designSource: project.designSource,
    garmentTemplateKey: project.garmentTemplateKey,
    customTemplate: Boolean(project.customTemplateAttachmentId),
    fabric: { name: project.fabricName, productId: project.fabricProductId },
    customer: { targetCustomer: project.targetCustomer, ageGroup: project.ageGroup },
    product: { category: project.productCategory },
    environment: { key: project.environmentKey, label: project.environmentLabel },
    brandName: project.brandName,
    viewAngle: "FRONT",
  };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_GENERATE",
    promptVersion: NEW_DESIGN_PROMPT_VERSION,
    specJson: specJson as Prisma.InputJsonValue,
    promptText: prompt,
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });
  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: swapCapability,
      generationContext: `AI Designer / New Design ${project.projectNumber}`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        const fabricImage = { buffer: fabricBuffer, mimeType: fabricAttachment.mimeType };
        // Both methods are the same real two-image edit (image 1 = model
        // template, image 2 = fabric); the prompt carries the dress-swap rules.
        if (swapCapability === "DESIGN_REPLICATION" && provider.replicateWithNewMaterial) {
          return provider.replicateWithNewMaterial({ prompt, count: input.imageCount, referenceImage: template, materialImage: fabricImage });
        }
        if (provider.applyFabric) {
          return provider.applyFabric({ prompt, count: input.imageCount, baseImage: template, swatchImage: fabricImage });
        }
        throw new ImageGenerationServiceError(
          `The configured image provider ("${provider.name}") cannot dress a model photo in a new fabric — use a provider that supports two-image editing (OpenAI or Gemini).`,
          "UNSUPPORTED_OPERATION"
        );
      },
    });

    const images = await persistImages(actor, projectId, generation.id, result.images, "GENERATED_DESIGN_IMAGE");
    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);
    if (images.length > 0) await bumpVersion(actor, projectId, images[0].id, "Design generated on catalogue model.", specJson);

    await AiDesignerProjectRepository.update(projectId, { status: "IN_PROGRESS", newDesignStep: "DESIGNS" });
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { imageCount: images.length, provider: result.providerName, model: result.model, template: project.garmentTemplateKey },
    });
    return { generation, images, usedTemplate: true as const };
  } catch (err) {
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", err instanceof Error ? err.message : "Unknown error.");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Colour variants (View page)
// ---------------------------------------------------------------------------

export async function listColorVariants(actor: ActorContext, projectId: string) {
  await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId).then((p) => {
    if (!p) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  });
  const generations = await AiDesignerGenerationRepository.findManyByProjectAndPromptType(projectId, "COLOR_VARIANT");
  return generations.flatMap((g) =>
    g.images.map((img) => ({ id: img.id, imageAttachmentId: img.imageAttachmentId, colorName: g.editedFeature, createdAt: img.createdAt }))
  );
}

export async function generateColorVariants(actor: ActorContext, projectId: string, input: { colors: string[] }) {
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const full = await getProjectById(actor.companyId, projectId);
  const baseImage = full.currentVersion?.currentImage;
  if (!baseImage) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first — there is no current image to recolour.");

  const colors = [...new Set(input.colors.map((c) => c.trim()).filter(Boolean))].slice(0, 6);
  if (colors.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "Pick at least one colour.");
  await assertNoActiveRun(projectId, "COLOR_VARIANT");

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, baseImage.imageAttachmentId);
  const results: { colorName: string; ok: boolean; error?: string }[] = [];

  for (const colorName of colors) {
    const prompt = buildColorVariantPrompt(colorName);
    const promptRow = await AiDesignerPromptRepository.create({
      companyId: actor.companyId,
      projectId,
      promptType: "COLOR_VARIANT",
      promptVersion: NEW_DESIGN_PROMPT_VERSION,
      specJson: { colorName, baseImageId: baseImage.id } as Prisma.InputJsonValue,
      promptText: prompt,
      provider: "pending",
      model: "pending",
      status: "IN_PROGRESS",
      createdByUserId: actor.userId,
    });
    const generation = await AiDesignerGenerationRepository.create({
      companyId: actor.companyId,
      projectId,
      promptId: promptRow.id,
      parentImageId: baseImage.id,
      editedFeature: colorName,
      requestedImageCount: 1,
      status: "IN_PROGRESS",
      createdByUserId: actor.userId,
    });
    try {
      const result = await runWithFailover({
        companyId: actor.companyId,
        userId: actor.userId,
        capability: "IMAGE_EDIT",
        generationContext: `AI Designer / Colour Variant ${project.projectNumber}`,
        aiDesignerProjectId: projectId,
        inputImagePresent: true,
        call: (provider) => {
          if (!provider.generateVariation) {
            throw new ImageGenerationServiceError(`The configured image provider ("${provider.name}") does not support image editing.`, "UNSUPPORTED_OPERATION");
          }
          return provider.generateVariation({ prompt, count: 1, parentImage: { buffer, mimeType: attachment.mimeType } });
        },
      });
      await persistImages(actor, projectId, generation.id, result.images, "COLOR_VARIANT_IMAGE");
      await AiDesignerGenerationRepository.markSuccess(generation.id);
      await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);
      results.push({ colorName, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      await AiDesignerGenerationRepository.markFailed(generation.id);
      await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
      results.push({ colorName, ok: false, error: message });
    }
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { colorVariants: results },
  });

  if (results.every((r) => !r.ok)) {
    throw new BusinessRuleError("AI_SERVICE_ERROR", results[0]?.error ?? "Colour variant generation failed.");
  }
  return { results, variants: await listColorVariants(actor, projectId) };
}

// ---------------------------------------------------------------------------
// Step 4 — the designs list, and making one design the current version
// ---------------------------------------------------------------------------

/** Only the Generate step's own images (never colour variants or edit previews), newest first. */
export async function listGeneratedDesigns(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const generations = await AiDesignerGenerationRepository.findManyByProjectAndPromptType(projectId, "IMAGE_GENERATE");
  return generations.flatMap((g) => g.images).filter((img) => img.decision !== "REJECTED");
}

/**
 * Opening a specific design in the View/Edit pages works on the project's
 * CURRENT version — so choosing a design that isn't current records it as a
 * new version (full history kept, nothing overwritten) and marks it SELECTED.
 */
export async function makeImageCurrent(actor: ActorContext, projectId: string, imageId: string) {
  const full = await getProjectById(actor.companyId, projectId);
  const image = await AiDesignerImageRepository.findById(imageId);
  if (!image || image.projectId !== projectId) throw new BusinessRuleError("NOT_FOUND", "Design image not found.", { id: imageId });

  if (full.currentVersion?.currentImageId !== imageId) {
    await bumpVersion(actor, projectId, imageId, "Design chosen from generated set.", {
      selectedFromImageId: imageId,
      previousVersionId: full.currentVersionId,
    });
  }
  if (image.decision !== "SELECTED") await AiDesignerImageRepository.update(imageId, { decision: "SELECTED" });
  return getProjectById(actor.companyId, projectId);
}

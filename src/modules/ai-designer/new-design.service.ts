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
import { ImageGenerationServiceError, type ImageGenerationProvider } from "@/core/ai/image-generation/types";
import { analyzeGarment, PROMPT_VERSION as GARMENT_PROMPT_VERSION } from "@/core/ai-designer/garment-analysis/analyze";
import type { GarmentAnalysisResponse } from "@/core/ai-designer/garment-analysis/schema";
import {
  buildColorVariantPrompt,
  buildTemplateDressSwapPrompt,
  buildTechnicalSketchGenerationPrompt,
  buildSketchEditPrompt,
  buildSketchPenMarkupPrompt,
  NEW_DESIGN_PROMPT_VERSION,
  pickDesignDirections,
} from "@/core/ai-designer/image-generation/new-design-prompt";
import { buildTechnicalFlatPrompt } from "@/core/ai/technical-development/prompt";
import {
  getGarmentTemplate,
  rankGarmentTemplates,
  templatePublicPath,
  type GarmentSuggestion,
} from "@/core/ai-designer/catalogs/garment-template-catalog";
import { describeSketchChange } from "@/core/ai-designer/catalogs/sketch-structure-catalog";
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
  applyEditVariation,
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

type ImageInput = { buffer: Buffer; mimeType: string };

/**
 * Picks the provider capability + call for a technical CAD flat sketch.
 * With a reference image it is a TECHNICAL_FLAT transform (generateTechnicalFlat,
 * falling back to a plain image edit); without one it is TEXT_TO_IMAGE.
 */
function technicalSketchRun(prompt: string, count: number, refImage: ImageInput | null) {
  if (refImage) {
    return {
      capability: "TECHNICAL_FLAT" as const,
      call: (provider: ImageGenerationProvider) => {
        if (provider.generateTechnicalFlat) return provider.generateTechnicalFlat({ prompt, count, baseImage: refImage });
        if (provider.generateVariation) return provider.generateVariation({ prompt, count, parentImage: refImage });
        throw new ImageGenerationServiceError("Configured image provider cannot generate technical flat sketches.", "UNSUPPORTED_OPERATION");
      },
    };
  }
  return {
    capability: "TEXT_TO_IMAGE" as const,
    call: (provider: ImageGenerationProvider) => provider.generate({ prompt, count }),
  };
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

/**
 * Stores generated images and returns ONLY the rows just created (in order).
 * `kind` is stored on the row; SKETCH rows may be linked to the garment they
 * were drawn from via `sketchForImageId`.
 */
async function persistImages(
  actor: ActorContext,
  projectId: string,
  generationId: string,
  images: { buffer: Buffer; mimeType: string }[],
  contextLabel: string,
  options: { kind?: "GARMENT" | "SKETCH"; sketchForImageId?: string | null } = {}
) {
  const kind = options.kind ?? (contextLabel === "GENERATED_SKETCH_IMAGE" ? "SKETCH" : "GARMENT");
  const attachmentIds: string[] = [];
  const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
  for (let i = 0; i < images.length; i++) {
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: images[i].buffer, fileName: `ai-designer-${Date.now()}-${i + 1}.png`, mimeType: images[i].mimeType },
      contextLabel
    );
    attachmentIds.push(attachment.id);
    rows.push({
      companyId: actor.companyId,
      projectId,
      generationId,
      imageAttachmentId: attachment.id,
      kind,
      // Only one sketch can be linked to a garment, so only the first image of a batch takes the link.
      sketchForImageId: i === 0 ? options.sketchForImageId ?? null : null,
      createdByUserId: actor.userId,
    });
  }
  await AiDesignerImageRepository.createMany(rows);
  const all = await AiDesignerImageRepository.findByGenerationId(generationId);
  return attachmentIds.map((id) => all.find((img) => img.imageAttachmentId === id)).filter((img) => img !== undefined);
}

function buildProjectSketchPrompt(project: AiDesignerProject) {
  return buildTechnicalSketchGenerationPrompt({
    garmentType: project.productCategory || "Garment",
    targetCustomer: TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] ?? "Women",
    ageGroup: project.ageGroup || "Adult",
    designBrief: buildDesignBrief(project),
    fabricDetails: project.fabricName ? `${project.fabricName}${project.fabricComposition ? ` (${project.fabricComposition})` : ""}` : null,
    viewAngle: "BOTH",
  });
}

const SKETCH_CONCURRENCY = 2;

/**
 * Draws one CAD flat sketch per garment, each from that garment's own photo,
 * and links it to the garment. A failed sketch never fails the garments —
 * it is counted so the UI can offer "Generate sketch" for that design.
 */
async function generatePairedSketches(
  actor: ActorContext,
  project: AiDesignerProject,
  generationId: string,
  garments: { imageId: string; image: ImageInput }[]
) {
  const prompt = buildProjectSketchPrompt(project);
  const sketches: Awaited<ReturnType<typeof persistImages>> = [];
  let failures = 0;
  let lastError: string | null = null;

  for (let i = 0; i < garments.length; i += SKETCH_CONCURRENCY) {
    const batch = garments.slice(i, i + SKETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (g) => {
        const result = await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          generationContext: `AI Designer / Technical Sketch ${project.projectNumber}`,
          aiDesignerProjectId: project.id,
          inputImagePresent: true,
          ...technicalSketchRun(prompt, 1, g.image),
        });
        if (result.images.length === 0) throw new Error("The provider returned no sketch image.");
        return persistImages(actor, project.id, generationId, result.images.slice(0, 1), "GENERATED_SKETCH_IMAGE", {
          kind: "SKETCH",
          sketchForImageId: g.imageId,
        });
      })
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") sketches.push(...outcome.value);
      else {
        failures++;
        lastError = outcome.reason instanceof Error ? outcome.reason.message : "Sketch generation failed.";
      }
    }
  }
  return { sketches, failures, lastError };
}

async function loadImageBuffer(companyId: string, attachmentId: string): Promise<ImageInput> {
  const { attachment, buffer } = await getAttachmentForDownload(companyId, attachmentId);
  return { buffer, mimeType: attachment.mimeType };
}

export async function generateNewDesign(
  actor: ActorContext,
  projectId: string,
  input: { imageCount: 1 | 3 | 4 }
) {
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
    const garments = await Promise.all(
      result.images.map(async (img) => ({ imageId: img.id, image: await loadImageBuffer(actor.companyId, img.imageAttachmentId) }))
    );
    const paired = await generatePairedSketches(actor, project, result.generation.id, garments);
    await syncProjectSketchToCurrent(actor.companyId, projectId);
    await AiDesignerProjectRepository.update(projectId, { newDesignStep: "DESIGNS" });
    return {
      ...result,
      sketches: paired.sketches,
      sketchFailures: paired.failures,
      sketchError: paired.lastError,
      usedTemplate: false as const,
    };
  }

  await assertNoActiveRun(projectId, "IMAGE_GENERATE");
  const { attachment: fabricAttachment, buffer: fabricBuffer } = await getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId!);

  const environment = project.environmentKey ? getEnvironmentByKey(project.environmentKey) : undefined;
  const keepTemplateBackground = !project.environmentKey || project.environmentKey === STUDIO_ENVIRONMENT_KEY;
  const designBrief = buildDesignBrief(project);
  // One design direction per requested image, so 3 designs are 3 different
  // garments instead of the same prompt repeated three times.
  const directions = pickDesignDirections(project.productCategory!, input.imageCount, { hasBrief: Boolean(designBrief) });
  const prompts = directions.map((direction, i) =>
    buildTemplateDressSwapPrompt({
      garmentType: project.productCategory!,
      targetCustomer: TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] ?? "Women",
      ageGroup: project.ageGroup || "Adult",
      designBrief,
      environmentLabel: project.environmentLabel || "Studio White",
      environmentHint: project.isCustomEnvironment ? project.environmentLabel : environment?.promptHint ?? null,
      keepTemplateBackground,
      variation: {
        optionNumber: i + 1,
        totalOptions: directions.length,
        direction,
        otherDirections: directions.filter((_, j) => j !== i),
      },
    })
  );
  const prompt =
    prompts.length === 1
      ? prompts[0]
      : prompts.map((p, i) => `===== DESIGN OPTION ${i + 1} of ${prompts.length} =====\n\n${p}`).join("\n\n");

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
    // Same order as the generated images.
    designDirections: directions,
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
    const fabricImage = { buffer: fabricBuffer, mimeType: fabricAttachment.mimeType };
    // One call per design option, each with its own prompt. Sequential, not
    // parallel, so a rate-limited (e.g. free-tier) provider isn't burst.
    const runs = [];
    for (const optionPrompt of prompts) {
      runs.push(
        await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: swapCapability,
          generationContext: `AI Designer / New Design ${project.projectNumber}`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            // Both methods are the same real two-image edit (image 1 = model
            // template, image 2 = fabric); the prompt carries the dress-swap rules.
            if (swapCapability === "DESIGN_REPLICATION" && provider.replicateWithNewMaterial) {
              return provider.replicateWithNewMaterial({ prompt: optionPrompt, count: 1, referenceImage: template, materialImage: fabricImage });
            }
            if (provider.applyFabric) {
              return provider.applyFabric({ prompt: optionPrompt, count: 1, baseImage: template, swatchImage: fabricImage });
            }
            throw new ImageGenerationServiceError(
              `The configured image provider ("${provider.name}") cannot dress a model photo in a new fabric — use a provider that supports two-image editing (OpenAI or Gemini).`,
              "UNSUPPORTED_OPERATION"
            );
          },
        })
      );
    }
    const result = {
      images: runs.flatMap((r) => r.images),
      providerName: [...new Set(runs.map((r) => r.providerName))].join(", "),
      model: [...new Set(runs.map((r) => r.model))].join(", "),
    };

    const images = await persistImages(actor, projectId, generation.id, result.images, "GENERATED_DESIGN_IMAGE");
    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);
    if (images.length > 0) await bumpVersion(actor, projectId, images[0].id, "Design generated on catalogue model.", specJson);

    // Every garment gets its own CAD sketch, drawn from that garment's photo.
    const paired = await generatePairedSketches(
      actor,
      project,
      generation.id,
      images.map((img, i) => ({ imageId: img.id, image: { buffer: result.images[i].buffer, mimeType: result.images[i].mimeType } }))
    );
    await syncProjectSketchToCurrent(actor.companyId, projectId);

    await AiDesignerProjectRepository.update(projectId, { status: "IN_PROGRESS", newDesignStep: "DESIGNS" });
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: {
        imageCount: images.length,
        sketchCount: paired.sketches.length,
        sketchFailures: paired.failures,
        provider: result.providerName,
        model: result.model,
        template: project.garmentTemplateKey,
      },
    });
    return {
      generation,
      images,
      sketches: paired.sketches,
      sketchFailures: paired.failures,
      sketchError: paired.lastError,
      usedTemplate: true as const,
    };
  } catch (err) {
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", err instanceof Error ? err.message : "Unknown error.");
    throw err;
  }
}

/**
 * Generates a technical CAD flat sketch for the project's CURRENT design
 * (View/Edit "Re-generate"). When the current design is a garment photo the
 * sketch is linked to it, replacing that garment's previous sketch.
 */
export async function generateSketchForProject(
  actor: ActorContext,
  projectId: string,
  options?: { viewAngle?: "FRONT" | "BACK" | "BOTH"; notes?: string }
) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });

  const current = project.currentVersion?.currentImage ?? null;
  let refImage: ImageInput | null = null;
  if (current) refImage = await loadImageBuffer(actor.companyId, current.imageAttachmentId);
  else if (project.sourceImageAttachmentId) refImage = await loadImageBuffer(actor.companyId, project.sourceImageAttachmentId);
  else if (project.fabricImageAttachmentId) refImage = await loadImageBuffer(actor.companyId, project.fabricImageAttachmentId);

  const garmentImageId = current && current.kind === "GARMENT" ? current.id : null;
  return runStandaloneSketch(actor, project, { refImage, garmentImageId, notes: options?.notes, viewAngle: options?.viewAngle });
}

/**
 * (Re)draws the CAD sketch for ONE generated garment — used by the Designs
 * grid's "Generate sketch" (retry after a failure, or an older design that
 * never had one). The garment's previous sketch is unlinked, never deleted.
 */
export async function generateSketchForImage(actor: ActorContext, projectId: string, imageId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const image = await AiDesignerImageRepository.findById(imageId);
  if (!image || image.projectId !== projectId) throw new BusinessRuleError("NOT_FOUND", "Design image not found.", { id: imageId });
  if (image.kind !== "GARMENT") throw new BusinessRuleError("VALIDATION_ERROR", "A sketch can only be generated for a garment design.");

  const refImage = await loadImageBuffer(actor.companyId, image.imageAttachmentId);
  const result = await runStandaloneSketch(actor, project, { refImage, garmentImageId: image.id });
  return { ...result, garmentImageId: image.id };
}

async function runStandaloneSketch(
  actor: ActorContext,
  project: NonNullable<Awaited<ReturnType<typeof AiDesignerProjectRepository.findByIdWithDetails>>>,
  input: { refImage: ImageInput | null; garmentImageId: string | null; notes?: string; viewAngle?: "FRONT" | "BACK" | "BOTH" }
) {
  const projectId = project.id;
  const prompt = input.notes ? buildTechnicalFlatPrompt({ additionalNotes: input.notes }) : buildProjectSketchPrompt(project);
  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_GENERATE",
    promptVersion: NEW_DESIGN_PROMPT_VERSION,
    specJson: { generateSketch: true, projectId, garmentImageId: input.garmentImageId, viewAngle: input.viewAngle ?? "BOTH" },
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
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      generationContext: `AI Designer / Generate CAD Sketch ${project.projectNumber}`,
      aiDesignerProjectId: projectId,
      inputImagePresent: Boolean(input.refImage),
      ...technicalSketchRun(prompt, 1, input.refImage),
    });
    if (result.images.length === 0) throw new Error("The provider returned no sketch image.");

    if (input.garmentImageId) await AiDesignerImageRepository.unlinkSketchFor(input.garmentImageId);
    const images = await persistImages(actor, projectId, generation.id, result.images.slice(0, 1), "GENERATED_SKETCH_IMAGE", {
      kind: "SKETCH",
      sketchForImageId: input.garmentImageId,
    });
    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    // Only the CURRENT design's sketch is the working sketch the edit page uses.
    const isCurrent = !input.garmentImageId || input.garmentImageId === project.currentVersion?.currentImageId;
    if (images.length > 0 && isCurrent) {
      await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: images[0].imageAttachmentId });
    }
    if (images.length > 0 && !project.currentVersionId) {
      await bumpVersion(actor, projectId, images[0].id, "Technical CAD flat sketch generated.", { sketchOnly: true });
    }
    return { generation, images, sketchAttachmentId: images[0]?.imageAttachmentId ?? null };
  } catch (err) {
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", err instanceof Error ? err.message : "Unknown error.");
    throw err;
  }
}

/**
 * Renders the realistic garment, in the project's fabric, that matches a
 * CAD sketch (sketch = reference image, fabric = material image).
 */
async function renderGarmentFromSketch(
  actor: ActorContext,
  project: Pick<
    AiDesignerProject,
    "id" | "projectNumber" | "fabricImageAttachmentId" | "productCategory" | "targetCustomer" | "ageGroup" | "environmentLabel" | "isCustomEnvironment"
  >,
  sketch: ImageInput,
  designBrief: string | null
) {
  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Add a fabric photo to this design before rendering the garment from its sketch.");
  }
  const swatch = await loadImageBuffer(actor.companyId, project.fabricImageAttachmentId);
  const garmentPrompt = buildTemplateDressSwapPrompt({
    garmentType: project.productCategory || "Garment",
    targetCustomer: TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] ?? "Women",
    ageGroup: project.ageGroup || "Adult",
    designBrief: designBrief ?? "Follow the supplied technical flat sketch exactly",
    environmentLabel: project.environmentLabel || "Studio White",
    environmentHint: project.isCustomEnvironment ? project.environmentLabel : null,
    keepTemplateBackground: true,
  });

  return runWithFailover({
    companyId: actor.companyId,
    userId: actor.userId,
    capability: "DESIGN_REPLICATION",
    generationContext: `AI Designer / Render Garment from Sketch ${project.projectNumber}`,
    aiDesignerProjectId: project.id,
    inputImagePresent: true,
    call: (provider) => {
      if (provider.replicateWithNewMaterial) {
        return provider.replicateWithNewMaterial({ prompt: garmentPrompt, count: 1, referenceImage: sketch, materialImage: swatch });
      }
      if (provider.applyFabric) {
        return provider.applyFabric({ prompt: garmentPrompt, count: 1, baseImage: sketch, swatchImage: swatch });
      }
      if (provider.generateVariation) {
        return provider.generateVariation({ prompt: garmentPrompt, count: 1, parentImage: sketch });
      }
      return provider.generate({ prompt: garmentPrompt, count: 1 });
    },
  });
}

// ---------------------------------------------------------------------------
// Applying an edit keeps the garment and its sketch in step
// ---------------------------------------------------------------------------

/**
 * "Select & Apply" on an edit preview. Whatever was edited, the new version
 * always ends up with a garment photo AND its matching sketch:
 *   - garment preview: becomes the design, and gets its own sketch;
 *   - sketch preview: the garment rendered with it (or rendered now) becomes
 *     the design, and the sketch becomes the working sketch.
 */
export async function applyEditWithPairedSketch(actor: ActorContext, imageId: string, input: { confirmed: boolean }) {
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Applying an edit as the new current design requires explicit confirmation.");
  }
  const image = await AiDesignerImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Previewed image not found.", { id: imageId });
  }

  if (image.kind === "GARMENT") {
    const version = await applyEditVariation(actor, imageId, input);
    const sketchError = await ensureSketchForGarment(actor, image.projectId, imageId);
    return { ...version, sketchError };
  }

  // A sketch preview: the design must be a garment, so find or render the garment for it.
  if (image.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This preview has already been decided — generate a new preview to try again.");
  }
  let garmentId = image.sketchForImageId;
  if (!garmentId) {
    const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, image.projectId);
    if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: image.projectId });
    const sketch = await loadImageBuffer(actor.companyId, image.imageAttachmentId);
    const rendered = await renderGarmentFromSketch(actor, project, sketch, null);
    if (rendered.images.length === 0) throw new BusinessRuleError("AI_SERVICE_ERROR", "The garment could not be rendered from this sketch.");
    // Same generation as the sketch, so it is a preview of the same edit of the current design.
    const [garment] = await persistImages(actor, image.projectId, image.generationId, rendered.images.slice(0, 1), "GENERATED_DESIGN_IMAGE", {
      kind: "GARMENT",
    });
    await AiDesignerImageRepository.update(imageId, { sketchForImageId: garment.id });
    garmentId = garment.id;
  }

  const version = await applyEditVariation(actor, garmentId, input);
  // applyEditVariation rejects the other previews of the edit — this sketch is the garment's own, so keep it.
  await AiDesignerImageRepository.update(imageId, { decision: "SELECTED" });
  await AiDesignerProjectRepository.update(image.projectId, { sketchImageAttachmentId: image.imageAttachmentId });
  return { ...version, sketchError: null };
}

/**
 * Makes sure a (now current) garment has its own sketch, generating one if
 * needed, and makes it the working sketch. Returns an error message instead
 * of throwing — the garment edit itself has already been applied.
 */
async function ensureSketchForGarment(actor: ActorContext, projectId: string, garmentId: string): Promise<string | null> {
  const existing = await AiDesignerImageRepository.findSketchFor(garmentId);
  if (existing) {
    await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: existing.imageAttachmentId });
    return null;
  }
  try {
    await generateSketchForImage(actor, projectId, garmentId);
    return null;
  } catch (err) {
    // Never leave the previous design's sketch showing next to the new garment.
    await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: null });
    return err instanceof Error ? err.message : "The sketch could not be generated.";
  }
}

/**
 * "Apply sketch to garment" (edit page, Options tab): renders the garment
 * from the current working sketch and records it as a new version, so the
 * garment catches up with the construction options applied to the sketch.
 */
export async function applyWorkingSketchToGarment(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.sketchImageAttachmentId) throw new BusinessRuleError("VALIDATION_ERROR", "This design has no sketch yet.");

  const sketchImage = await AiDesignerImageRepository.findByProjectAndAttachment(projectId, project.sketchImageAttachmentId);
  const current = project.currentVersion?.currentImage ?? null;
  if (sketchImage?.sketchForImageId && sketchImage.sketchForImageId === current?.id) {
    throw new BusinessRuleError("VALIDATION_ERROR", "The garment already matches this sketch — apply a construction option first.");
  }

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: NEW_DESIGN_PROMPT_VERSION,
    specJson: { sketchToGarment: true, sourceSketchAttachmentId: project.sketchImageAttachmentId } as Prisma.InputJsonValue,
    promptText: "Render the garment from the edited technical flat sketch.",
    provider: "pending",
    model: "pending",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });
  const generation = await AiDesignerGenerationRepository.create({
    companyId: actor.companyId,
    projectId,
    promptId: promptRow.id,
    parentImageId: current?.id ?? null,
    editedFeature: "Sketch → Garment",
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const sketch = await loadImageBuffer(actor.companyId, project.sketchImageAttachmentId);
    const rendered = await renderGarmentFromSketch(actor, project, sketch, null);
    if (rendered.images.length === 0) throw new Error("The provider returned no garment image.");
    const [garment] = await persistImages(actor, projectId, generation.id, rendered.images.slice(0, 1), "GENERATED_DESIGN_IMAGE", {
      kind: "GARMENT",
    });
    // Link the sketch to its new garment (a sketch already paired with an older garment keeps that pairing).
    if (sketchImage && !sketchImage.sketchForImageId) {
      await AiDesignerImageRepository.update(sketchImage.id, { sketchForImageId: garment.id });
    }
    await AiDesignerImageRepository.update(garment.id, { decision: "SELECTED" });
    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, rendered.providerName, rendered.model);

    const version = await bumpVersion(
      actor,
      projectId,
      garment.id,
      "Garment updated from the edited sketch.",
      (project.currentVersion?.designSnapshotJson as Record<string, unknown> | undefined) ?? {},
      { approvalStatus: "AI_MODIFIED", aiPromptId: promptRow.id }
    );
    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_versions",
      recordId: version.id,
      action: "CREATE",
      newValues: { versionNumber: version.versionNumber, imageId: garment.id, fromSketchAttachmentId: project.sketchImageAttachmentId },
    });
    return version;
  } catch (err) {
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", err instanceof Error ? err.message : "Unknown error.");
    throw err;
  }
}

/** Points the project's working sketch at the CURRENT garment's own sketch (or clears it). */
async function syncProjectSketchToCurrent(companyId: string, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, projectId);
  const current = project?.currentVersion?.currentImage;
  if (!project || !current || current.kind !== "GARMENT") return;
  const sketch = await AiDesignerImageRepository.findSketchFor(current.id);
  await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: sketch?.imageAttachmentId ?? null });
}

/**
 * Undo on the edit page: makes an earlier sketch of THIS project the working
 * sketch again. Accepts a generated SKETCH image's attachment, or the
 * project's own uploaded source sketch.
 */
export async function setCurrentSketch(actor: ActorContext, projectId: string, attachmentId: string) {
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const isSourceSketch = project.designSource === "SKETCH" && project.sourceImageAttachmentId === attachmentId;
  if (!isSourceSketch) {
    const image = await AiDesignerImageRepository.findByProjectAndAttachment(projectId, attachmentId);
    if (!image) throw new BusinessRuleError("NOT_FOUND", "Sketch not found for this design.", { attachmentId });
    if (image.kind !== "SKETCH") throw new BusinessRuleError("VALIDATION_ERROR", "Only a sketch can be restored as the working sketch.");
  }
  await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: attachmentId });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { sketchImageAttachmentId: project.sketchImageAttachmentId },
    newValues: { sketchImageAttachmentId: attachmentId },
  });
  return getProjectById(actor.companyId, projectId);
}

/**
 * Edits through sketch: modifies the technical CAD sketch and optionally
 * renders the revised realistic garment in the project's fabric.
 */
export async function executeSketchEdit(
  actor: ActorContext,
  projectId: string,
  input: {
    instruction?: string | null;
    structuralFields?: Record<string, string> | null;
    viewAngle: "FRONT" | "BACK" | "BOTH";
    imageCount: number;
    generateGarment?: boolean;
    sketchImageAttachmentId?: string | null;
  },
  /** "Draw with Pen": the sketch with the designer's pen strokes composited on top. */
  options?: { markupImage?: ImageInput | null }
) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });

  const markupImage = options?.markupImage ?? null;
  const hasFields = Boolean(input.structuralFields && Object.values(input.structuralFields).some((v) => v && v.trim()));
  if (!markupImage && !input.instruction?.trim() && !hasFields) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Draw your changes on the sketch with the pen, pick a construction option, or describe the change before generating."
    );
  }

  const targetSketchId =
    input.sketchImageAttachmentId ||
    project.sketchImageAttachmentId ||
    (project.designSource === "SKETCH" ? project.sourceImageAttachmentId : null);

  let sketchRef: { buffer: Buffer; mimeType: string } | null = null;
  let markupAttachmentId: string | null = null;
  if (markupImage) {
    // The pen-marked sketch IS the reference; keep a copy so the edit's input can be reviewed later.
    const saved = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: markupImage.buffer, fileName: `sketch-pen-markup-${Date.now()}.png`, mimeType: markupImage.mimeType },
      "SKETCH_PEN_MARKUP"
    );
    markupAttachmentId = saved.id;
    sketchRef = markupImage;
  } else if (targetSketchId) {
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, targetSketchId);
    sketchRef = { buffer, mimeType: attachment.mimeType };
  } else if (project.currentVersion?.currentImage) {
    // Auto-generate sketch from current garment if no sketch exists yet
    const generated = await generateSketchForProject(actor, projectId);
    if (generated.images[0]) {
      const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, generated.images[0].imageAttachmentId);
      sketchRef = { buffer, mimeType: attachment.mimeType };
    }
  }

  const promptContext = {
    garmentType: project.productCategory,
    structuralChanges: input.structuralFields,
    instruction: input.instruction,
    viewAngle: input.viewAngle,
  };
  const prompt = markupImage ? buildSketchPenMarkupPrompt(promptContext) : buildSketchEditPrompt(promptContext);

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: NEW_DESIGN_PROMPT_VERSION,
    specJson: {
      sketchEdit: true,
      penMarkup: Boolean(markupImage),
      markupAttachmentId,
      sourceSketchAttachmentId: targetSketchId,
      structuralFields: input.structuralFields,
      instruction: input.instruction,
    } as Prisma.InputJsonValue,
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
    parentImageId: project.currentVersion?.currentImageId || null,
    editedFeature: markupImage ? "Sketch Pen Markup" : "Through Sketch Edit",
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "IMAGE_EDIT",
      generationContext: `AI Designer / Sketch Edit ${project.projectNumber}`,
      aiDesignerProjectId: projectId,
      inputImagePresent: Boolean(sketchRef),
      call: (provider) => {
        if (!sketchRef) return provider.generate({ prompt, count: input.imageCount });
        if (provider.generateVariation) {
          return provider.generateVariation({ prompt, count: input.imageCount, parentImage: sketchRef });
        }
        throw new ImageGenerationServiceError(`Configured image provider cannot generate variations.`, "UNSUPPORTED_OPERATION");
      },
    });

    const sketchImages = await persistImages(actor, projectId, generation.id, result.images, "GENERATED_SKETCH_IMAGE", { kind: "SKETCH" });
    const allImages = [...sketchImages];

    // If generateGarment is requested (default true) and fabric exists, also generate garment matching revised sketch
    if (input.generateGarment !== false && project.fabricImageAttachmentId && sketchImages.length > 0) {
      try {
        const garmentResult = await renderGarmentFromSketch(
          actor,
          project,
          { buffer: result.images[0].buffer, mimeType: result.images[0].mimeType },
          [
            markupImage ? "Follow the revised technical flat sketch exactly (designer's pen-marked construction changes applied)" : null,
            input.instruction?.trim() || null,
            input.structuralFields
              ? Object.entries(input.structuralFields)
                  .filter(([, v]) => v && v.trim())
                  .map(([k, v]) => describeSketchChange(k, v.trim()))
                  .join(" ")
              : null,
          ]
            .filter(Boolean)
            .join(". ") || null
        ).catch(() => null);

        if (garmentResult && garmentResult.images.length > 0) {
          const garmentImages = await persistImages(actor, projectId, generation.id, garmentResult.images, "GENERATED_DESIGN_IMAGE", { kind: "GARMENT" });
          // The revised sketch is this new garment's own sketch.
          if (garmentImages[0]) {
            await AiDesignerImageRepository.update(sketchImages[0].id, { sketchForImageId: garmentImages[0].id });
          }
          allImages.unshift(...garmentImages);
        }
      } catch {
        // Soft fail garment generation so sketch edits persist cleanly
      }
    }

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);
    if (sketchImages.length > 0) {
      await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: sketchImages[0].imageAttachmentId });
    }

    return { generation, images: allImages };
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

/**
 * The Designs grid: only GARMENT images from the Generate step (never colour
 * variants or edit previews), newest first — each with its own linked sketch.
 * Sketches are no longer separate cards.
 */
export async function listGeneratedDesigns(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const generations = await AiDesignerGenerationRepository.findManyByProjectAndPromptType(projectId, "IMAGE_GENERATE");
  return generations
    .flatMap((g) => g.images)
    .filter((img) => img.kind === "GARMENT" && img.decision !== "REJECTED")
    .map((img) => ({
      ...img,
      sketch: img.sketch && img.sketch.decision !== "REJECTED" ? { id: img.sketch.id, imageAttachmentId: img.sketch.imageAttachmentId } : null,
    }));
}

/**
 * Opening a specific design in the View/Edit pages works on the project's
 * CURRENT version — so choosing a design that isn't current records it as a
 * new version (full history kept, nothing overwritten) and marks it SELECTED.
 * The project's working sketch follows: it becomes THIS garment's own sketch.
 */
export async function makeImageCurrent(actor: ActorContext, projectId: string, imageId: string) {
  const full = await getProjectById(actor.companyId, projectId);
  const image = await AiDesignerImageRepository.findById(imageId);
  if (!image || image.projectId !== projectId) throw new BusinessRuleError("NOT_FOUND", "Design image not found.", { id: imageId });
  if (image.kind !== "GARMENT") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Open the garment design — its sketch opens with it.");
  }

  if (full.currentVersion?.currentImageId !== imageId) {
    await bumpVersion(actor, projectId, imageId, "Design chosen from generated set.", {
      selectedFromImageId: imageId,
      previousVersionId: full.currentVersionId,
    });
  }
  if (image.decision !== "SELECTED") await AiDesignerImageRepository.update(imageId, { decision: "SELECTED" });
  const sketch = await AiDesignerImageRepository.findSketchFor(imageId);
  await AiDesignerProjectRepository.update(projectId, { sketchImageAttachmentId: sketch?.imageAttachmentId ?? null });
  return getProjectById(actor.companyId, projectId);
}

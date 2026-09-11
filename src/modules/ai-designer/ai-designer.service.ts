import sharp from "sharp";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { deleteAttachment, getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiConfigMissingError } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { analyzeFabric } from "@/core/ai-designer/fabric-analysis/analyze";
import { buildUserText, PROMPT_VERSION as FABRIC_PROMPT_VERSION } from "@/core/ai-designer/fabric-analysis/prompt";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import { buildEditPrompt, buildGenerationPrompt, buildSecondFabricPrompt, PROMPT_VERSION as GENERATION_PROMPT_VERSION } from "@/core/ai-designer/image-generation/prompt";
import type { TechPackSpecItem } from "@/core/ai-designer/export/tech-pack-pdf";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";
import { isValidAgeGroup, isValidProductCategory, TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { ProductRepository } from "@/modules/products/product.repository";
import type { ListQuery } from "@/lib/list-query";
import { generateGrading, generateTechPackBom } from "@/core/ai-designer/tech-pack/generate";
import { buildFlatSketchPrompt } from "@/core/ai-designer/tech-pack/prompt";
import type { TechPackDesignContext } from "@/core/ai-designer/tech-pack/prompt";
import {
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
  AiDesignerVersionRepository,
  AiDesignerTechPackRepository,
} from "./ai-designer.repository";
import type {
  ApplySecondFabricInput,
  CreateProjectInput,
  DecideImageInput,
  EditDesignInput,
  ExportFormat,
  GenerateDesignInput,
  SaveWizardSelectionsInput,
  SelectExistingFabricInput,
  UpdateFabricFieldInput,
} from "./ai-designer.schema";
import type { AiDesignerProject, Prisma } from "@prisma/client";

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

/**
 * Own resumable-wizard step order — mirrors the *shape* of AiGarmentProject's
 * step machinery, not shared code (confirmed separate module). MULTI_FABRIC
 * and TECH_PACK are both optional/skippable steps -- nothing downstream
 * requires either to be completed, so a project that never uses them simply
 * never marks them complete (this only affects the display-only "current
 * step" highlight, not navigation, which is entirely user-driven via each
 * step's own Next button — see AiDesignerWorkflowPanel.tsx).
 */
export const WIZARD_STEP_ORDER = [
  "FABRIC_SELECTION",
  "FABRIC_ANALYSIS",
  "TARGET_CUSTOMER",
  "AGE_GROUP",
  "PRODUCT_CATEGORY",
  "PRODUCT_DESIGN",
  "MODEL",
  "ENVIRONMENT",
  "GENERATE",
  "MULTI_FABRIC",
  "EDIT",
  "TECH_PACK",
  "EXPORT",
] as const;
export type WizardStep = (typeof WIZARD_STEP_ORDER)[number];

function markStepsComplete(existing: string[], steps: WizardStep[]): string[] {
  const set = new Set(existing);
  for (const step of steps) set.add(step);
  return WIZARD_STEP_ORDER.filter((s) => set.has(s));
}

function computeCurrentStep(completedSteps: string[]): WizardStep {
  return WIZARD_STEP_ORDER.find((s) => !completedSteps.includes(s)) ?? "EXPORT";
}

const RUN_FRESHNESS_WINDOW_MS = 3 * 60 * 1000;

function errorCategoryForAi(err: unknown): string {
  if (err instanceof AiConfigMissingError) return "MISSING_CONFIG";
  if (err instanceof AiServiceError) return err.category;
  if (err instanceof AiInvalidResponseError) return "NO_STRUCTURED_RESPONSE";
  return "UNKNOWN";
}

function mapAiError(err: unknown): never {
  if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
    throw new BusinessRuleError("AI_SERVICE_ERROR", err.message);
  }
  throw err;
}

function normalizeImageMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/webp") return "image/webp";
  throw new BusinessRuleError(
    "VALIDATION_ERROR",
    `Unsupported fabric image type "${mimeType}" — upload a JPG, PNG, or WEBP image.`
  );
}

async function getOwnedProject(companyId: string, id: string) {
  const project = await AiDesignerProjectRepository.findAnyById(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id });
  return project;
}

async function assertNoActiveRun(projectId: string, promptType: "FABRIC_ANALYSIS" | "IMAGE_GENERATE" | "IMAGE_EDIT") {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const active = await AiDesignerPromptRepository.findActiveSince(projectId, promptType, freshSince);
  if (active) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "An AI request is already in progress for this project.", {
      promptId: active.id,
    });
  }
}

// ---------------------------------------------------------------------------
// List / get
// ---------------------------------------------------------------------------

export async function listProjects(companyId: string, query: ListQuery) {
  const where: Prisma.AiDesignerProjectWhereInput = {
    companyId,
    ...(query.search ? { projectName: { contains: query.search, mode: "insensitive" as const } } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AiDesignerProjectRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    AiDesignerProjectRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getProjectById(companyId: string, id: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id });
  return project;
}

// ---------------------------------------------------------------------------
// Step 1 — Fabric Selection
// ---------------------------------------------------------------------------

export async function createProject(actor: ActorContext, input: CreateProjectInput) {
  const projectNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "AI_DESIGNER_PROJECT",
  });

  const project = await AiDesignerProjectRepository.create({
    companyId: actor.companyId,
    projectNumber,
    projectName: input.projectName,
    status: "DRAFT",
    currentStep: "FABRIC_SELECTION",
    completedSteps: [],
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: project.id,
    action: "CREATE",
    newValues: { projectNumber: project.projectNumber, projectName: project.projectName },
  });

  return project;
}

/** Auto-fills only what's genuinely on the real Fabric Master row (Name/Code/Supplier) — GSM/Composition/Width/Color etc. stay blank/user-editable, matching the confirmed real-schema gap. */
export async function selectExistingFabric(actor: ActorContext, projectId: string, input: SelectExistingFabricInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const material = await ProductRepository.findMaterialById(actor.companyId, input.fabricProductId);
  if (!material) throw new BusinessRuleError("NOT_FOUND", "Fabric not found in the Fabric Master.", { id: input.fabricProductId });

  // Deliberately does NOT clear fabricImageAttachmentId. The real Fabric
  // Master (Product) carries no photo of its own (confirmed by schema
  // inspection — only Name/Code/Supplier/unit cost exist there), so picking
  // an existing fabric's metadata and uploading/attaching its real photo are
  // two independent actions that must be able to coexist — generation
  // requires the real photo regardless of where the metadata came from (see
  // assertReadyToGenerate). fabricSource is only set here if it hasn't
  // already been set by an earlier upload, so it always reflects whichever
  // fabric action happened first, not whichever happened most recently.
  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_SELECTION"]);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "EXISTING",
    fabricProductId: material.id,
    fabricName: material.styleName,
    fabricCode: material.styleCode,
    fabricSupplierId: material.defaultSupplierId,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "EXISTING", fabricProductId: material.id },
  });

  return updated;
}

export async function uploadFabricImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "FABRIC_IMAGE");

  // Deliberately does NOT clear fabricProductId/fabricSupplierId — a user
  // may have already picked an existing fabric's metadata (Name/Code/
  // Supplier) and is now separately attaching its real photo, which
  // generation actually requires (see assertReadyToGenerate). fabricSource
  // is only set here if this is the first fabric action taken on the
  // project, matching selectExistingFabric's own symmetric rule.
  const project = await getOwnedProject(actor.companyId, projectId);
  const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_SELECTION"]);
  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricSource: project.fabricSource ?? "UPLOADED",
    fabricImageAttachmentId: attachment.id,
    completedSteps,
    currentStep: computeCurrentStep(completedSteps),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { fabricSource: "UPLOADED", fabricImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteFabricImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no uploaded fabric image to delete.");
  }

  await deleteAttachment(actor, project.fabricImageAttachmentId);

  const updated = await AiDesignerProjectRepository.update(projectId, {
    fabricImageAttachmentId: null,
    fabricSource: project.fabricProductId ? "EXISTING" : null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { fabricImageAttachmentId: project.fabricImageAttachmentId },
    newValues: { fabricImageAttachmentId: null },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Step 2 — Analyze Fabric with AI
// ---------------------------------------------------------------------------

export async function runFabricAnalysis(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);

  if (!project.fabricImageAttachmentId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This project has no fabric photo to analyze — pick \"Upload Fabric Image\" in Step 1, or fill in the fabric fields below manually."
    );
  }
  await assertNoActiveRun(projectId, "FABRIC_ANALYSIS");

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.fabricImageAttachmentId);
  const mediaType = normalizeImageMediaType(attachment.mimeType);

  const projectContext = {
    productCategory: project.productCategory,
    targetCustomerLabel: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : null,
  };
  const userText = buildUserText(projectContext);

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "FABRIC_ANALYSIS",
    promptVersion: FABRIC_PROMPT_VERSION,
    specJson: projectContext,
    promptText: userText,
    provider: "anthropic",
    model: process.env.ANTHROPIC_VISION_MODEL || "claude-opus-5",
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await analyzeFabric({ imageBuffer: buffer, imageMediaType: mediaType, projectContext });

    const completedSteps = markStepsComplete(project.completedSteps, ["FABRIC_ANALYSIS"]);
    const updated = await AiDesignerProjectRepository.update(projectId, {
      fabricName: result.data.fabricName,
      fabricComposition: result.data.composition,
      fabricGsm: result.data.gsm,
      fabricWidth: result.data.width,
      fabricWeave: result.data.weave,
      fabricStretch: result.data.stretch,
      fabricOpacity: result.data.opacity,
      fabricTexture: result.data.texture,
      fabricPatternType: result.data.patternType,
      fabricPrintType: result.data.printType,
      fabricSuitableSeason: result.data.suitableSeason,
      fabricRecommendedGarments: result.data.recommendedGarments,
      completedSteps,
      currentStep: computeCurrentStep(completedSteps),
    });

    await AiDesignerPromptRepository.markSuccess(promptRow.id);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_prompts",
      recordId: promptRow.id,
      action: "CREATE",
      newValues: { promptType: "FABRIC_ANALYSIS", status: "SUCCESS" },
    });

    return updated;
  } catch (err) {
    const category = errorCategoryForAi(err);
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerPromptRepository.markFailed(promptRow.id, category, message);
    mapAiError(err);
  }
}

export async function updateFabricAnalysisField(actor: ActorContext, projectId: string, input: UpdateFabricFieldInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const updated = await AiDesignerProjectRepository.update(projectId, { [input.field]: input.value });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    oldValues: { [input.field]: (project as unknown as Record<string, unknown>)[input.field] },
    newValues: { [input.field]: input.value },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Steps 3-8 — Target Customer / Age Group / Product Category / Design / Model / Environment
// ---------------------------------------------------------------------------

export async function saveWizardSelections(actor: ActorContext, projectId: string, input: SaveWizardSelectionsInput) {
  const project = await getOwnedProject(actor.companyId, projectId);

  const data: Prisma.AiDesignerProjectUncheckedUpdateInput = {};
  const touchedSteps: WizardStep[] = [];
  const effectiveCustomer = (input.targetCustomer ?? project.targetCustomer) as TargetCustomer | null;

  if (input.targetCustomer !== undefined) {
    data.targetCustomer = input.targetCustomer;
    touchedSteps.push("TARGET_CUSTOMER");
  }
  if (input.ageGroup !== undefined) {
    if (effectiveCustomer && !isValidAgeGroup(effectiveCustomer, input.ageGroup)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${input.ageGroup}" is not a valid age group for ${effectiveCustomer}.`);
    }
    data.ageGroup = input.ageGroup;
    touchedSteps.push("AGE_GROUP");
  }
  if (input.productCategory !== undefined) {
    if (effectiveCustomer && !isValidProductCategory(effectiveCustomer, input.productCategory)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${input.productCategory}" is not a valid product category for ${effectiveCustomer}.`);
    }
    data.productCategory = input.productCategory;
    touchedSteps.push("PRODUCT_CATEGORY");
  }
  if (input.designSelections !== undefined) {
    const existing = (project.designSelectionsJson as Record<string, string> | null) ?? {};
    data.designSelectionsJson = { ...existing, ...input.designSelections } as Prisma.InputJsonValue;
    touchedSteps.push("PRODUCT_DESIGN");
  }
  if (input.modelGender !== undefined) data.modelGender = input.modelGender;
  if (input.modelBodyType !== undefined) data.modelBodyType = input.modelBodyType;
  if (input.modelPose !== undefined) data.modelPose = input.modelPose;
  if (input.modelGender !== undefined || input.modelBodyType !== undefined || input.modelPose !== undefined) {
    touchedSteps.push("MODEL");
  }

  if (input.isCustomEnvironment) {
    data.isCustomEnvironment = true;
    data.environmentKey = null;
    if (input.environmentLabel !== undefined) data.environmentLabel = input.environmentLabel;
    touchedSteps.push("ENVIRONMENT");
  } else if (input.environmentKey !== undefined) {
    if (input.environmentKey) {
      const env = getEnvironmentByKey(input.environmentKey);
      if (!env) throw new BusinessRuleError("VALIDATION_ERROR", `Unknown environment "${input.environmentKey}".`);
      data.environmentKey = env.key;
      data.environmentLabel = input.environmentLabel || env.label;
      data.isCustomEnvironment = false;
    } else {
      data.environmentKey = null;
      data.environmentLabel = input.environmentLabel ?? null;
      data.isCustomEnvironment = false;
    }
    touchedSteps.push("ENVIRONMENT");
  }

  const completedSteps = markStepsComplete(project.completedSteps, touchedSteps);
  data.completedSteps = completedSteps;
  data.currentStep = computeCurrentStep(completedSteps);

  const updated = await AiDesignerProjectRepository.update(projectId, data);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: data as Record<string, unknown>,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Step 9 — Generate Design
// ---------------------------------------------------------------------------

/**
 * A real fabric REFERENCE IMAGE is a hard requirement, not just fabric
 * metadata — the whole point of this fix is that generation must use the
 * actual fabric photo as a visual reference, never just its text
 * description. The real Fabric Master (Product) carries no photo of its
 * own, so picking an "existing" fabric alone is never sufficient; the user
 * must also upload/attach that fabric's real photo (Step 1's second field)
 * before Generate Design becomes available, regardless of fabricSource.
 */
function assertReadyToGenerate(project: AiDesignerProject) {
  const missing: string[] = [];
  if (!project.fabricImageAttachmentId) {
    missing.push("a real fabric reference photo (Step 1 — upload the actual fabric image, even if you picked an existing fabric's details)");
  }
  if (!project.targetCustomer) missing.push("Target Customer");
  if (!project.ageGroup) missing.push("Age Group");
  if (!project.productCategory) missing.push("Product Category");
  if (!project.modelGender || !project.modelBodyType || !project.modelPose) missing.push("Model");
  if (!project.environmentLabel) missing.push("Environment");

  if (missing.length > 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `Complete the following before generating a design: ${missing.join(", ")}.`,
      { missing }
    );
  }
}

function buildDesignSelectionsText(project: AiDesignerProject): string {
  const selections = (project.designSelectionsJson as Record<string, string> | null) ?? {};
  const entries = Object.entries(selections);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}: ${value}`).join("; ") : "Not specified";
}

function buildSpecJson(project: AiDesignerProject): Record<string, unknown> {
  return {
    fabric: {
      source: project.fabricSource,
      name: project.fabricName,
      code: project.fabricCode,
      composition: project.fabricComposition,
      gsm: project.fabricGsm,
      width: project.fabricWidth,
      weave: project.fabricWeave,
      stretch: project.fabricStretch,
      opacity: project.fabricOpacity,
      texture: project.fabricTexture,
      patternType: project.fabricPatternType,
      printType: project.fabricPrintType,
      suitableSeason: project.fabricSuitableSeason,
      recommendedGarments: project.fabricRecommendedGarments,
      color: project.fabricColor,
    },
    customer: { targetCustomer: project.targetCustomer, ageGroup: project.ageGroup },
    product: { category: project.productCategory },
    design: project.designSelectionsJson ?? {},
    model: { gender: project.modelGender, bodyType: project.modelBodyType, pose: project.modelPose },
    environment: { key: project.environmentKey, label: project.environmentLabel, isCustom: project.isCustomEnvironment },
  };
}

async function bumpVersion(actor: ActorContext, projectId: string, imageId: string, changeSummary: string, specJson: Record<string, unknown>) {
  const count = await AiDesignerVersionRepository.count(projectId);
  const version = await AiDesignerVersionRepository.create({
    companyId: actor.companyId,
    projectId,
    versionNumber: count + 1,
    currentImageId: imageId,
    changeSummary,
    designSnapshotJson: specJson as Prisma.InputJsonValue,
    createdByUserId: actor.userId,
  });
  await AiDesignerProjectRepository.update(projectId, { currentVersionId: version.id });
  return version;
}

export async function generateDesign(actor: ActorContext, projectId: string, input: GenerateDesignInput) {
  const project = await getOwnedProject(actor.companyId, projectId);
  assertReadyToGenerate(project);
  await assertNoActiveRun(projectId, "IMAGE_GENERATE");

  // The real fabric photo, not its text description, is what makes this a
  // genuine visual reference — assertReadyToGenerate() already guarantees
  // fabricImageAttachmentId is set at this point.
  const { attachment: fabricAttachment, buffer: fabricBuffer } = await getAttachmentForDownload(
    actor.companyId,
    project.fabricImageAttachmentId!
  );

  const specJson = buildSpecJson(project);
  const prompt = buildGenerationPrompt({
    targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
    ageGroup: project.ageGroup || "Not specified",
    productCategory: project.productCategory || "Not specified",
    designSelections: buildDesignSelectionsText(project),
    modelGender: project.modelGender || "Not specified",
    modelBodyType: project.modelBodyType || "Not specified",
    modelPose: project.modelPose || "Not specified",
    environment: project.environmentLabel || "Not specified",
  });

  // Provider/model are placeholders until a real provider is actually
  // resolved by AIProviderManager below — with automatic failover, the
  // provider that ends up serving this request can genuinely differ from
  // whichever one looks like "the" configured provider at this point, so
  // this row is corrected to the real provider/model on success (see
  // markSuccessWithProvider).
  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_GENERATE",
    promptVersion: GENERATION_PROMPT_VERSION,
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
    // Routed through AIProviderManager — capability-filtered, priority-
    // sorted, with automatic failover to the next configured provider on a
    // transient failure (quota/rate-limit/timeout/outage), and a clean,
    // honest error if no configured provider currently supports fabric-
    // reference generation at all. Never silently falls back to a
    // text-only call — a provider missing this capability throws
    // UNSUPPORTED_OPERATION here, which AIProviderManager treats as a
    // non-failover-eligible configuration problem (see its own comment),
    // exactly the "never fake fabric usage" requirement.
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "FABRIC_REFERENCE",
      generationContext: `AI Designer / Project ${project.projectNumber}`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.generateFromFabricReference) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support generating a design from a fabric reference image — it can only do text-to-image, which cannot preserve the actual fabric photo.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.generateFromFabricReference({
          prompt,
          count: input.imageCount,
          fabricImage: { buffer: fabricBuffer, mimeType: fabricAttachment.mimeType },
        });
      },
    });

    const rows: Prisma.AiDesignerImageUncheckedCreateInput[] = [];
    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      const attachment = await uploadAttachment(
        actor,
        "AI_DESIGNER_PROJECT",
        projectId,
        { buffer: img.buffer, fileName: `ai-designer-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "GENERATED_DESIGN_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await AiDesignerImageRepository.createMany(rows);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    if (images.length > 0) {
      await bumpVersion(actor, projectId, images[0].id, "Initial design generated.", specJson);
    }

    const completedSteps = markStepsComplete(project.completedSteps, ["GENERATE"]);
    await AiDesignerProjectRepository.update(projectId, {
      status: "IN_PROGRESS",
      completedSteps,
      currentStep: computeCurrentStep(completedSteps),
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images };
  } catch (err) {
    // AIProviderManager already classified and logged the real per-provider
    // failure(s) into AIProviderUsage/AIFailoverLog — this local row just
    // needs the final, user-facing message for this project's own history.
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 10 — Edit Design
// ---------------------------------------------------------------------------

export async function editDesign(actor: ActorContext, projectId: string, input: EditDesignInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before editing it.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);

  const prompt = buildEditPrompt({
    featureLabel: input.featureLabel,
    currentValue: input.currentValue || "Not specified",
    newValue: input.newValue,
    additionalInstructions: input.additionalInstructions || null,
  });

  const specJson = { ...buildSpecJson(project), edit: { featureLabel: input.featureLabel, currentValue: input.currentValue || null, newValue: input.newValue } };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: GENERATION_PROMPT_VERSION,
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
    parentImageId: parentImage.id,
    editedFeature: input.featureLabel,
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "IMAGE_EDIT",
      generationContext: `AI Designer / Project ${project.projectNumber} / Edit`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.generateVariation) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support editing an existing image.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.generateVariation({
          prompt,
          count: 1,
          parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
        });
      },
    });

    const img = result.images[0];
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: img.buffer, fileName: `ai-designer-edit-${Date.now()}.png`, mimeType: img.mimeType },
      "GENERATED_DESIGN_IMAGE"
    );
    await AiDesignerImageRepository.createMany([
      { companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId },
    ]);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    const version = await bumpVersion(actor, projectId, images[0].id, `Changed ${input.featureLabel}: ${input.newValue}`, specJson);

    const completedSteps = markStepsComplete(project.completedSteps, ["EDIT"]);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { editedFeature: input.featureLabel, versionNumber: version.versionNumber, provider: result.providerName, model: result.model },
    });

    return { generation, images, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 9b — Multi-Fabric
// ---------------------------------------------------------------------------

export async function uploadSecondFabricImage(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "SECOND_FABRIC_IMAGE");
  const updated = await AiDesignerProjectRepository.update(projectId, { secondFabricImageAttachmentId: attachment.id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { secondFabricImageAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteSecondFabricImage(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.secondFabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no second fabric image to delete.");
  }
  await deleteAttachment(actor, project.secondFabricImageAttachmentId);
  return AiDesignerProjectRepository.update(projectId, { secondFabricImageAttachmentId: null });
}

/**
 * Applies the second fabric onto specific area(s) of the CURRENT design
 * image — a genuine two-image composition (current design + second fabric
 * swatch), reusing the exact same AiDesignerPrompt/AiDesignerGeneration/
 * AiDesignerImage/version-bump machinery Edit Design already uses (this is
 * structurally "take the existing image and modify it," just via
 * `provider.applyFabric` instead of `provider.generateVariation`, and its
 * own prompt) — deliberately reuses the `IMAGE_EDIT` promptType/gating
 * rather than adding a new enum value purely for bookkeeping, since the
 * concurrency-guard behaviour it buys (never run two concurrent
 * image-mutating calls against the same project) is exactly what's wanted
 * here too.
 */
export async function applySecondFabric(actor: ActorContext, projectId: string, input: ApplySecondFabricInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before applying a second fabric.");
  }
  if (!project.secondFabricImageAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Upload a second fabric photo first.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);
  const { attachment: swatchAttachment, buffer: swatchBuffer } = await getAttachmentForDownload(actor.companyId, project.secondFabricImageAttachmentId);

  const prompt = buildSecondFabricPrompt(input.applyAreas);
  const areaSummary = input.applyAreas.join(", ");
  const specJson = { ...buildSpecJson(project), secondFabric: { applyAreas: input.applyAreas } };

  const promptRow = await AiDesignerPromptRepository.create({
    companyId: actor.companyId,
    projectId,
    promptType: "IMAGE_EDIT",
    promptVersion: GENERATION_PROMPT_VERSION,
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
    parentImageId: parentImage.id,
    editedFeature: `Second Fabric Application: ${areaSummary}`,
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "MULTI_FABRIC",
      generationContext: `AI Designer / Project ${project.projectNumber} / Multi-Fabric`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.applyFabric) {
          throw new ImageGenerationServiceError(
            `The configured image provider ("${provider.name}") does not support applying a second fabric onto an existing design — it needs a genuine two-image composition capability.`,
            "UNSUPPORTED_OPERATION"
          );
        }
        return provider.applyFabric({
          prompt,
          count: 1,
          baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
          swatchImage: { buffer: swatchBuffer, mimeType: swatchAttachment.mimeType },
        });
      },
    });

    const img = result.images[0];
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: img.buffer, fileName: `ai-designer-multifabric-${Date.now()}.png`, mimeType: img.mimeType },
      "GENERATED_DESIGN_IMAGE"
    );
    await AiDesignerImageRepository.createMany([
      { companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId },
    ]);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    const version = await bumpVersion(actor, projectId, images[0].id, `Applied second fabric to: ${areaSummary}`, specJson);

    const completedSteps = markStepsComplete(project.completedSteps, ["MULTI_FABRIC"]);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { secondFabricApplyAreas: input.applyAreas, versionNumber: version.versionNumber, provider: result.providerName, model: result.model },
    });

    return { generation, images, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Images / decisions / versions
// ---------------------------------------------------------------------------

export async function decideImage(actor: ActorContext, imageId: string, input: DecideImageInput) {
  const image = await AiDesignerImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Generated image not found.", { id: imageId });
  }
  if (input.decision === "SELECT" && !input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Selecting a design as the final visual requires explicit confirmation.");
  }

  const decision = input.decision === "SELECT" ? "SELECTED" : "REJECTED";
  const updated = await AiDesignerImageRepository.update(imageId, { decision });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_images",
    recordId: imageId,
    action: "UPDATE",
    oldValues: { decision: image.decision },
    newValues: { decision },
  });

  return updated;
}

/** Every generated image across every generation for this project — the Step 9 gallery's real data source, so Select/Reject state survives a page reload instead of only ever showing the most recent in-session generate/edit call. */
export async function listImages(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerImageRepository.findByProjectId(projectId);
}

export async function listVersions(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerVersionRepository.findByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Tech Pack — graded measurements + BOM + technical flat sketch in one action
// ---------------------------------------------------------------------------

function buildTechPackDesignContext(project: AiDesignerProject): TechPackDesignContext {
  return {
    productCategory: project.productCategory || "Not specified",
    designSelections: buildDesignSelectionsText(project),
    fabricDescription: [project.fabricName, project.fabricComposition, project.fabricGsm].filter(Boolean).join(", ") || "Not specified",
    targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
    ageGroup: project.ageGroup || "Not specified",
  };
}

async function assertNoActiveTechPackRun(projectId: string) {
  const freshSince = new Date(Date.now() - RUN_FRESHNESS_WINDOW_MS);
  const latest = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (latest && latest.status === "IN_PROGRESS" && latest.createdAt >= freshSince) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A tech pack is already being generated for this project.", {
      techPackId: latest.id,
    });
  }
}

/**
 * One combined action producing all three tech-pack deliverables — graded
 * measurements, a draft BOM, and a technical flat sketch — from the
 * project's own currently generated design. Deliberately all-or-nothing: if
 * any one of the three calls fails, the whole attempt is marked FAILED with
 * that error, rather than persisting a partially-successful run — simpler
 * to reason about, and a retry is cheap (this is a manual, low-frequency
 * action, not a hot path). Zero reuse of AI Garment Flow's own, much richer
 * equivalent processes — see this file's own schema comment on
 * AiDesignerTechPack for why.
 */
export async function generateTechPack(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before creating its tech pack.");
  }
  await assertNoActiveTechPackRun(projectId);

  const techPackRow = await AiDesignerTechPackRepository.create({
    companyId: actor.companyId,
    projectId,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const designContext = buildTechPackDesignContext(project);
    const { attachment: baseAttachment, buffer: baseBuffer } = await getAttachmentForDownload(
      actor.companyId,
      project.currentVersion.currentImage.imageAttachmentId
    );

    const [gradingResult, bomResult, flatSketchResult] = await Promise.all([
      generateGrading(designContext),
      generateTechPackBom(designContext),
      runWithFailover({
        companyId: actor.companyId,
        userId: actor.userId,
        capability: "TECHNICAL_FLAT",
        generationContext: `AI Designer / Project ${project.projectNumber} / Tech Pack`,
        aiDesignerProjectId: projectId,
        inputImagePresent: true,
        call: (provider) => {
          if (!provider.generateTechnicalFlat) {
            throw new ImageGenerationServiceError(
              `The configured image provider ("${provider.name}") does not support generating a technical flat sketch.`,
              "UNSUPPORTED_OPERATION"
            );
          }
          return provider.generateTechnicalFlat({
            prompt: buildFlatSketchPrompt(),
            count: 1,
            baseImage: { buffer: baseBuffer, mimeType: baseAttachment.mimeType },
          });
        },
      }),
    ]);

    const flatSketchImg = flatSketchResult.images[0];
    const flatSketchAttachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: flatSketchImg.buffer, fileName: `ai-designer-flat-sketch-${Date.now()}.png`, mimeType: flatSketchImg.mimeType },
      "TECH_PACK_FLAT_SKETCH"
    );

    const measurementsJson = { points: gradingResult.data.points, generalNotes: gradingResult.data.generalNotes };
    const bomJson = { items: bomResult.data.items };

    const updated = await AiDesignerTechPackRepository.markSuccess(techPackRow.id, {
      flatSketchImageAttachmentId: flatSketchAttachment.id,
      measurementsJson: measurementsJson as Prisma.InputJsonValue,
      bomJson: bomJson as Prisma.InputJsonValue,
    });

    const completedSteps = markStepsComplete(project.completedSteps, ["TECH_PACK"]);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_tech_packs",
      recordId: techPackRow.id,
      action: "CREATE",
      newValues: { status: "SUCCESS", pointCount: gradingResult.data.points.length, bomLineCount: bomResult.data.items.length },
    });

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerTechPackRepository.markFailed(techPackRow.id, message);
    mapAiError(err);
  }
}

export async function getLatestTechPack(companyId: string, projectId: string) {
  await getOwnedProject(companyId, projectId);
  return AiDesignerTechPackRepository.findLatestByProjectId(projectId);
}

// ---------------------------------------------------------------------------
// Step 12 — Export
// ---------------------------------------------------------------------------

export async function exportProject(actor: ActorContext, projectId: string, format: ExportFormat) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design before exporting.");
  }

  const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, project.currentVersion.currentImage.imageAttachmentId);

  if (format === "png" || format === "jpg") {
    // The stored image's real bytes match whichever format the configured
    // image-generation provider actually returned (confirmed live: OpenAI
    // returns PNG, Cloudflare returns JPEG) — never necessarily the format
    // the user just clicked. A real conversion is required here, not just
    // relabeling the file extension, or a ".png" download could silently
    // contain JPEG bytes (or vice versa).
    const converted =
      format === "png"
        ? await sharp(buffer).png().toBuffer()
        : await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
    const mimeType = format === "png" ? "image/png" : "image/jpeg";
    return { buffer: converted, mimeType, fileName: `${project.projectNumber}.${format}` };
  }

  const fabricSpec: TechPackSpecItem[] = [
    { label: "Fabric Name", value: project.fabricName ?? "" },
    { label: "Code", value: project.fabricCode ?? "" },
    { label: "Composition", value: project.fabricComposition ?? "" },
    { label: "GSM", value: project.fabricGsm ?? "" },
    { label: "Width", value: project.fabricWidth ?? "" },
    { label: "Weave", value: project.fabricWeave ?? "" },
    { label: "Stretch", value: project.fabricStretch ?? "" },
    { label: "Opacity", value: project.fabricOpacity ?? "" },
    { label: "Texture", value: project.fabricTexture ?? "" },
    { label: "Pattern Type", value: project.fabricPatternType ?? "" },
    { label: "Print Type", value: project.fabricPrintType ?? "" },
    { label: "Color", value: project.fabricColor ?? "" },
  ];
  const customerProductSpec: TechPackSpecItem[] = [
    { label: "Target Customer", value: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "" },
    { label: "Age Group", value: project.ageGroup ?? "" },
    { label: "Product Category", value: project.productCategory ?? "" },
  ];
  const designSelections = (project.designSelectionsJson as Record<string, string> | null) ?? {};
  const designSpec: TechPackSpecItem[] = Object.entries(designSelections).map(([label, value]) => ({ label, value }));
  const modelEnvironmentSpec: TechPackSpecItem[] = [
    { label: "Model Gender", value: project.modelGender ?? "" },
    { label: "Body Type", value: project.modelBodyType ?? "" },
    { label: "Pose", value: project.modelPose ?? "" },
    { label: "Environment", value: project.environmentLabel ?? "" },
  ];

  // Lazy import — @react-pdf/renderer is only ever needed for this one
  // branch; loading it eagerly at module scope would drag its full
  // dependency chain into every caller of this file for no benefit.
  const { renderTechPackPdf } = await import("@/core/ai-designer/export/tech-pack-pdf");
  const pdfBuffer = await renderTechPackPdf({
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    imageBase64: buffer.toString("base64"),
    imageMimeType: attachment.mimeType,
    fabricSpec,
    customerProductSpec,
    designSpec,
    modelEnvironmentSpec,
    generatedAt: new Date().toLocaleString(),
  });

  return { buffer: pdfBuffer, mimeType: "application/pdf", fileName: `${project.projectNumber}.pdf` };
}

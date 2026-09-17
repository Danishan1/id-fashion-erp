import sharp from "sharp";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { deleteAttachment, getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiConfigMissingError } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { analyzeFabric } from "@/core/ai-designer/fabric-analysis/analyze";
import { buildUserText, PROMPT_VERSION as FABRIC_PROMPT_VERSION } from "@/core/ai-designer/fabric-analysis/prompt";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import { buildEmbellishmentPrompt, buildGenerationPrompt, buildSecondFabricPrompt, buildWorkspaceEditPrompt, PROMPT_VERSION as GENERATION_PROMPT_VERSION } from "@/core/ai-designer/image-generation/prompt";
import type { TechPackSpecItem, TechPackAnalysisForPdf, TechPackDocumentPageImage } from "@/core/ai-designer/export/tech-pack-pdf";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";
import { isValidAgeGroup, isValidProductCategory, TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { ProductRepository } from "@/modules/products/product.repository";
import type { ListQuery } from "@/lib/list-query";
import { generateGarmentAnalysisPart1, generateGarmentAnalysisPart2 } from "@/core/ai-designer/tech-pack/generate";
import type { TechPackDesignContext } from "@/core/ai-designer/tech-pack/prompt";
import {
  ARTWORK_ITEM_EDITABLE_FIELDS,
  BOM_ITEM_EDITABLE_FIELDS,
  CLOSURE_EDITABLE_FIELDS,
  CONSTRUCTION_EDITABLE_FIELDS,
  IDENTIFICATION_EDITABLE_FIELDS,
  MEASUREMENT_POINT_EDITABLE_FIELDS,
  PART1_SCALAR_FIELDS,
  PART2_SCALAR_FIELDS,
  PHOTO_PAGE_NUMBERS,
  SEAM_CALLOUT_STATUS_VALUES,
  SEAM_CALLOUT_TEXT_FIELDS,
  STANDARD_SIZES,
  SUGGESTED_COLORWAY_EDITABLE_FIELDS,
  TECH_PACK_PAGE_DEFINITIONS,
  VISIBLE_COLOR_EDITABLE_FIELDS,
  type GarmentAnalysis,
} from "@/core/ai-designer/tech-pack/schema";
import {
  AiDesignerGenerationRepository,
  AiDesignerImageRepository,
  AiDesignerProjectRepository,
  AiDesignerPromptRepository,
  AiDesignerVersionRepository,
  AiDesignerTechPackRepository,
} from "./ai-designer.repository";
import type {
  ApplyEditVariationInput,
  ApplyEmbellishmentsInput,
  ApplySecondFabricInput,
  CreateProjectInput,
  DecideImageInput,
  ExportFormat,
  GenerateDesignInput,
  GenerateEditPreviewInput,
  SaveWizardSelectionsInput,
  SelectExistingFabricInput,
  UpdateFabricFieldInput,
  UpdateTechPackFieldInput,
} from "./ai-designer.schema";
import { AiDesignerProjectStatus, type AiDesignerProject, type Prisma } from "@prisma/client";

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
 * step machinery, not shared code (confirmed separate module). MULTI_FABRIC,
 * EMBELLISHMENTS, and TECH_PACK are all optional/skippable steps -- nothing
 * downstream requires any of them to be completed, so a project that never
 * uses them simply never marks them complete (this only affects the
 * display-only "current step" highlight, not navigation, which is entirely
 * user-driven via each step's own Next button — see AiDesignerWorkflowPanel.tsx).
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
  "EMBELLISHMENTS",
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

/**
 * Tech Pack's own, much longer freshness window — a full run is now a
 * sequential chain of up to 10 real AI calls (1 vision + 2 text + 7 image
 * generations), which can legitimately take several minutes, unlike every
 * other single-call AI Designer action gated by RUN_FRESHNESS_WINDOW_MS
 * above. Kept as a separate constant rather than widening the shared one, so
 * the shorter window still applies correctly everywhere else.
 */
const TECH_PACK_RUN_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

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

const VALID_AI_DESIGNER_PROJECT_STATUSES = new Set<string>(Object.values(AiDesignerProjectStatus));

export async function listProjects(companyId: string, query: ListQuery) {
  const where: Prisma.AiDesignerProjectWhereInput = {
    companyId,
    ...(query.search ? { projectName: { contains: query.search, mode: "insensitive" as const } } : {}),
    ...(query.status && VALID_AI_DESIGNER_PROJECT_STATUSES.has(query.status)
      ? { status: query.status as AiDesignerProjectStatus }
      : {}),
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

async function bumpVersion(
  actor: ActorContext,
  projectId: string,
  imageId: string,
  changeSummary: string,
  specJson: Record<string, unknown>,
  options?: {
    approvalStatus?: "DRAFT" | "AI_MODIFIED";
    aiPromptId?: string;
    technicalChangesJson?: Record<string, string> | null;
  }
) {
  const count = await AiDesignerVersionRepository.count(projectId);
  const version = await AiDesignerVersionRepository.create({
    companyId: actor.companyId,
    projectId,
    versionNumber: count + 1,
    currentImageId: imageId,
    changeSummary,
    designSnapshotJson: specJson as Prisma.InputJsonValue,
    approvalStatus: options?.approvalStatus ?? "DRAFT",
    aiPromptId: options?.aiPromptId,
    technicalChangesJson: (options?.technicalChangesJson ?? undefined) as Prisma.InputJsonValue | undefined,
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

function changeSummaryForEdit(input: GenerateEditPreviewInput): string {
  if (input.mode === "QUICK") return `Changed ${input.featureLabel}: ${input.newValue}`;
  if (input.mode === "TECHNICAL") return `Technical edit — ${input.featureLabel}`;
  return `AI edit — ${input.featureLabel}`;
}

/**
 * Edit Design workspace, step 1 of 2 — generates 1-4 candidate images for a
 * requested change WITHOUT touching the current design at all (no version
 * bump, no currentVersionId change). The images are created PENDING, exactly
 * like the Step 9 gallery's own images, and must be explicitly applied via
 * applyEditVariation() below — this is the "AI must never immediately
 * overwrite the approved/current design; generate a preview first" rule,
 * enforced structurally rather than by convention.
 */
export async function generateEditPreview(actor: ActorContext, projectId: string, input: GenerateEditPreviewInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before editing it.");
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);

  // A real, confirmed-live bug fixed here: chaining edits purely from
  // image-to-image (each edit based only on the PREVIOUS edit's own output,
  // via generateVariation's single-image call) has no ground truth to check
  // fabric fidelity against — the "preserve fabric" wording in the prompt is
  // just text, unenforced by any actual image, so the fabric print/texture
  // visibly drifts further from the real original with every successive
  // edit. Fixed by re-fetching the project's own real original fabric photo
  // (always present — assertReadyToGenerate requires it before any design
  // can even be generated) and supplying it as a genuine second reference
  // image on every edit call (provider.applyFabric), the same "the image is
  // the source of truth, never text/memory alone" discipline already used
  // for the original Generate Design/Multi-Fabric calls.
  const fabricAttachmentId = project.fabricImageAttachmentId;
  const fabricRef = fabricAttachmentId ? await getAttachmentForDownload(actor.companyId, fabricAttachmentId) : null;

  const prompt = buildWorkspaceEditPrompt({
    mode: input.mode,
    featureLabel: input.featureLabel,
    currentValue: input.currentValue || "Not specified",
    newValue: input.newValue || null,
    technicalFields: input.technicalFields || null,
    freeformInstructions: input.freeformInstructions || null,
    hasFabricReference: !!fabricRef,
  });

  const specJson = {
    ...buildSpecJson(project),
    edit: {
      mode: input.mode,
      featureLabel: input.featureLabel,
      currentValue: input.currentValue || null,
      newValue: input.newValue || null,
      technicalFields: input.technicalFields || null,
      freeformInstructions: input.freeformInstructions || null,
    },
  };

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
    requestedImageCount: input.imageCount,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = fabricRef
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "MULTI_FABRIC",
          generationContext: `AI Designer / Project ${project.projectNumber} / Edit (fabric-grounded)`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.applyFabric) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support editing with a fabric reference.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.applyFabric({
              prompt,
              count: input.imageCount,
              baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
              swatchImage: { buffer: fabricRef.buffer, mimeType: fabricRef.attachment.mimeType },
            });
          },
        })
      : // Defensive fallback only — assertReadyToGenerate() guarantees a real
        // fabric photo exists before any design (and therefore any edit) can
        // exist at all, so this branch should never actually run in practice.
        await runWithFailover({
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
              count: input.imageCount,
              parentImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
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
        { buffer: img.buffer, fileName: `ai-designer-edit-${Date.now()}-${i + 1}.png`, mimeType: img.mimeType },
        "EDIT_PREVIEW_IMAGE"
      );
      rows.push({ companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId });
    }
    await AiDesignerImageRepository.createMany(rows);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: { editedFeature: input.featureLabel, mode: input.mode, imageCount: images.length, provider: result.providerName, model: result.model },
    });

    return { generation, images, prompt: promptRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerGenerationRepository.markFailed(generation.id);
    await AiDesignerPromptRepository.markFailed(promptRow.id, "PROVIDER_ERROR", message);
    throw err;
  }
}

/**
 * Edit Design workspace, step 2 of 2 — the explicit "Apply" action. Only a
 * PENDING image whose own generation was previewed from the project's
 * CURRENT design may be applied (a stale preview left over from before an
 * intervening change is rejected outright, not silently applied over the
 * wrong base) — promotes it to a real new AiDesignerVersion, marks its
 * sibling preview images REJECTED (never leaves them ambiguously PENDING),
 * and carries the originating AI prompt + any structured technical fields
 * onto the new version for the workspace's own version-history display.
 */
export async function applyEditVariation(actor: ActorContext, imageId: string, input: ApplyEditVariationInput) {
  if (!input.confirmed) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Applying an edit as the new current design requires explicit confirmation.");
  }

  const image = await AiDesignerImageRepository.findWithProjectOwner(imageId);
  if (!image || image.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Previewed image not found.", { id: imageId });
  }
  if (image.decision !== "PENDING") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This preview has already been decided — generate a new preview to try again.");
  }

  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, image.projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: image.projectId });

  const generation = await AiDesignerGenerationRepository.findByIdWithPrompt(image.generationId);
  if (!generation || !project.currentVersion || generation.parentImageId !== project.currentVersion.currentImageId) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      "This preview is no longer based on the current design — the design has changed since it was generated. Generate a new preview instead."
    );
  }

  const siblings = await AiDesignerImageRepository.findByGenerationId(image.generationId);
  await Promise.all(
    siblings.filter((s) => s.id !== imageId && s.decision === "PENDING").map((s) => AiDesignerImageRepository.update(s.id, { decision: "REJECTED" }))
  );
  await AiDesignerImageRepository.update(imageId, { decision: "SELECTED" });

  const editSpec = (generation.prompt.specJson as { edit?: { mode?: string; featureLabel?: string; newValue?: string; technicalFields?: Record<string, string> } })
    .edit;
  const mode = (editSpec?.mode as "QUICK" | "TECHNICAL" | "AI_PROMPT" | undefined) ?? "QUICK";
  const changeSummary = changeSummaryForEdit({
    mode,
    featureLabel: editSpec?.featureLabel ?? generation.editedFeature ?? "Edit",
    newValue: editSpec?.newValue,
    imageCount: 1,
  } as GenerateEditPreviewInput);

  const version = await bumpVersion(actor, image.projectId, imageId, changeSummary, project.currentVersion.designSnapshotJson as Record<string, unknown>, {
    approvalStatus: "AI_MODIFIED",
    aiPromptId: generation.promptId,
    technicalChangesJson: mode === "TECHNICAL" ? editSpec?.technicalFields ?? null : null,
  });

  const completedSteps = markStepsComplete(project.completedSteps, ["EDIT"]);
  await AiDesignerProjectRepository.update(image.projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "CREATE",
    newValues: { versionNumber: version.versionNumber, imageId, mode },
  });

  return version;
}

/** Top-toolbar "Approve Design" — approves the project's current version. */
export async function approveCurrentVersion(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before approving it.");

  const version = await AiDesignerVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return version;
}

/** Top-toolbar "Reject Design" — the review-workflow counterpart to Approve; does not delete or revert anything, only marks the current version's own review status. */
export async function rejectCurrentVersion(actor: ActorContext, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before rejecting it.");

  const version = await AiDesignerVersionRepository.updateApprovalStatus(project.currentVersion.id, {
    approvalStatus: "REJECTED",
    approvedByUserId: null,
    approvedAt: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_versions",
    recordId: version.id,
    action: "UPDATE",
    oldValues: { approvalStatus: project.currentVersion.approvalStatus },
    newValues: { approvalStatus: "REJECTED" },
  });

  return version;
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
// Step 9c — Embellishments
// ---------------------------------------------------------------------------

export async function uploadEmbellishmentMotif(actor: ActorContext, projectId: string, file: UploadableFile) {
  await getOwnedProject(actor.companyId, projectId);

  if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimeType)) {
    throw new BusinessRuleError("VALIDATION_ERROR", `Unsupported file type "${file.mimeType}" — upload a JPG, PNG, or WEBP image.`);
  }

  const attachment = await uploadAttachment(actor, "AI_DESIGNER_PROJECT", projectId, file, "EMBELLISHMENT_MOTIF_IMAGE");
  const updated = await AiDesignerProjectRepository.update(projectId, { embellishmentMotifAttachmentId: attachment.id });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_projects",
    recordId: projectId,
    action: "UPDATE",
    newValues: { embellishmentMotifAttachmentId: attachment.id },
  });

  return { project: updated, attachment };
}

export async function deleteEmbellishmentMotif(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  if (!project.embellishmentMotifAttachmentId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This project has no embellishment motif image to delete.");
  }
  await deleteAttachment(actor, project.embellishmentMotifAttachmentId);
  return AiDesignerProjectRepository.update(projectId, { embellishmentMotifAttachmentId: null });
}

/**
 * Applies a digital applique/embroidery embellishment onto the CURRENT
 * design image — either a genuine two-image composition (current design +
 * uploaded motif photo, via `provider.applyFabric`, reusing the MULTI_FABRIC
 * capability since it's mechanically the same two-image-composition call as
 * Multi-Fabric's own second-fabric application) or, when no motif photo was
 * uploaded, a single-image edit driven purely by the free-text instructions
 * (via `provider.generateVariation`, reusing the IMAGE_EDIT capability the
 * same way Edit Design's own single-image edits do). Deliberately no new
 * AIProviderCapability value — both branches are mechanically identical to
 * an existing, already-gated call, just with a different prompt.
 */
export async function applyEmbellishments(actor: ActorContext, projectId: string, input: ApplyEmbellishmentsInput) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  if (!project.currentVersion?.currentImage) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before applying embellishments.");
  }
  const trimmedInstructions = input.instructions?.trim() || undefined;
  if (!project.embellishmentMotifAttachmentId && !trimmedInstructions) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Upload an embroidery/applique motif image or enter embellishment instructions first."
    );
  }
  await assertNoActiveRun(projectId, "IMAGE_EDIT");

  const parentImage = project.currentVersion.currentImage;
  const { attachment: parentAttachment, buffer: parentBuffer } = await getAttachmentForDownload(actor.companyId, parentImage.imageAttachmentId);
  const motifRef = project.embellishmentMotifAttachmentId
    ? await getAttachmentForDownload(actor.companyId, project.embellishmentMotifAttachmentId)
    : null;

  const prompt = buildEmbellishmentPrompt(input.embellishmentType, trimmedInstructions, !!motifRef);
  const specJson = {
    ...buildSpecJson(project),
    embellishment: { embellishmentType: input.embellishmentType, instructions: trimmedInstructions ?? null },
  };

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
    editedFeature: `Embellishment: ${input.embellishmentType}`,
    requestedImageCount: 1,
    status: "IN_PROGRESS",
    createdByUserId: actor.userId,
  });

  try {
    const result = motifRef
      ? await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "MULTI_FABRIC",
          generationContext: `AI Designer / Project ${project.projectNumber} / Embellishments`,
          aiDesignerProjectId: projectId,
          inputImagePresent: true,
          call: (provider) => {
            if (!provider.applyFabric) {
              throw new ImageGenerationServiceError(
                `The configured image provider ("${provider.name}") does not support applying an embellishment motif onto an existing design — it needs a genuine two-image composition capability.`,
                "UNSUPPORTED_OPERATION"
              );
            }
            return provider.applyFabric({
              prompt,
              count: 1,
              baseImage: { buffer: parentBuffer, mimeType: parentAttachment.mimeType },
              swatchImage: { buffer: motifRef.buffer, mimeType: motifRef.attachment.mimeType },
            });
          },
        })
      : await runWithFailover({
          companyId: actor.companyId,
          userId: actor.userId,
          capability: "IMAGE_EDIT",
          generationContext: `AI Designer / Project ${project.projectNumber} / Embellishments`,
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
      { buffer: img.buffer, fileName: `ai-designer-embellishment-${Date.now()}.png`, mimeType: img.mimeType },
      "GENERATED_DESIGN_IMAGE"
    );
    await AiDesignerImageRepository.createMany([
      { companyId: actor.companyId, projectId, generationId: generation.id, imageAttachmentId: attachment.id, createdByUserId: actor.userId },
    ]);
    const images = await AiDesignerImageRepository.findByGenerationId(generation.id);

    await AiDesignerGenerationRepository.markSuccess(generation.id);
    await AiDesignerPromptRepository.markSuccessWithProvider(promptRow.id, result.providerName, result.model);

    const typeLabel = input.embellishmentType.replace(/_/g, " ");
    const changeSummary = `Applied embellishment: ${typeLabel}${trimmedInstructions ? ` — ${trimmedInstructions.slice(0, 80)}` : ""}`;
    const version = await bumpVersion(actor, projectId, images[0].id, changeSummary, specJson);

    const completedSteps = markStepsComplete(project.completedSteps, ["EMBELLISHMENTS"]);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_generations",
      recordId: generation.id,
      action: "CREATE",
      newValues: {
        embellishmentType: input.embellishmentType,
        instructions: trimmedInstructions ?? null,
        versionNumber: version.versionNumber,
        provider: result.providerName,
        model: result.model,
      },
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
// Tech Pack — full "GARMENT TECH PACK SPEC SHEET GENERATOR" pipeline: a
// comprehensive Garment Analysis (categories A-J) rendered as a real 7-page
// PDF from structured data via fixed @react-pdf/renderer templates. v3
// (2026-09-14) removed AI image generation from this feature entirely — the
// 3 pages that show a visual (Cover, Construction, Colorways) embed the
// project's own real, already-generated design photo instead of a freshly
// AI-drawn "flat", per the user's own explicit rule against fabricating page
// artwork. Also added a real approve/revision discipline (see
// updateTechPackField/approveTechPack/revertTechPackToOriginal below).
// ---------------------------------------------------------------------------

function buildTechPackDesignContext(project: AiDesignerProject): TechPackDesignContext {
  return {
    productCategory: project.productCategory || "Not specified",
    designSelections: buildDesignSelectionsText(project),
    fabricDescription: [project.fabricName, project.fabricComposition, project.fabricGsm].filter(Boolean).join(", ") || "Not specified",
    targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : "Not specified",
    ageGroup: project.ageGroup || "Not specified",
    projectName: project.projectName,
  };
}

async function assertNoActiveTechPackRun(projectId: string) {
  const freshSince = new Date(Date.now() - TECH_PACK_RUN_FRESHNESS_WINDOW_MS);
  const latest = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (latest && latest.status === "IN_PROGRESS" && latest.createdAt >= freshSince) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A tech pack is already being generated for this project.", {
      techPackId: latest.id,
    });
  }
}

/**
 * The full pipeline behind the user's own "GARMENT TECH PACK SPEC SHEET
 * GENERATOR" prompt (supplied verbatim, 2026-09-13) — sequential, not
 * parallel, since each step's output genuinely feeds the next: (1) a vision
 * call analyzes the current design image into categories A-G, (2) a text
 * call extends that into categories H-J (BOM/measurements/labels) plus
 * designer notes. Deliberately all-or-nothing: if either real AI call fails,
 * the whole attempt is marked FAILED, rather than persisting a partially-
 * successful run — simpler to reason about, and a retry is cheap (this is a
 * manual, low-frequency action, not a hot path). Zero reuse of AI Garment
 * Flow's own, much richer equivalent processes — this module stays
 * deliberately isolated from that one.
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
    const imageMediaType = normalizeImageMediaType(baseAttachment.mimeType);

    const part1 = await generateGarmentAnalysisPart1({
      ctx: designContext,
      imageBase64: baseBuffer.toString("base64"),
      imageMediaType,
    });
    const part2 = await generateGarmentAnalysisPart2({ ctx: designContext, part1: part1.data });

    // Pages 1/2/4 embed the project's own real design photo (the SAME
    // attachment id already on the project's current version, reused as-is
    // -- never re-uploaded, never freshly AI-generated). Every other page
    // has no image at all; its content is entirely real, typeset text.
    const realPhotoAttachmentId = project.currentVersion.currentImage.imageAttachmentId;
    const pages = TECH_PACK_PAGE_DEFINITIONS.map((def) => ({
      pageNumber: def.pageNumber,
      pageTitle: def.title,
      imageAttachmentId: (PHOTO_PAGE_NUMBERS as readonly number[]).includes(def.pageNumber) ? realPhotoAttachmentId : null,
    }));

    const garmentAnalysis: GarmentAnalysis = { part1: part1.data, part2: part2.data };

    const updated = await AiDesignerTechPackRepository.markSuccess(techPackRow.id, {
      garmentAnalysisJson: garmentAnalysis as unknown as Prisma.InputJsonValue,
      designerNotes: part2.data.designerNotes,
      suggestedAdditionalViews: part2.data.suggestedAdditionalViews,
      pages,
    });

    const completedSteps = markStepsComplete(project.completedSteps, ["TECH_PACK"]);
    await AiDesignerProjectRepository.update(projectId, { completedSteps, currentStep: computeCurrentStep(completedSteps) });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_tech_packs",
      recordId: techPackRow.id,
      action: "CREATE",
      newValues: { status: "SUCCESS", bomLineCount: part2.data.bomItems.length, pageCount: pages.length },
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

/** Downloads the latest successful Tech Pack as one combined PDF. */
export async function exportTechPackPdf(actor: ActorContext, projectId: string) {
  const project = await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (!techPack || techPack.status !== "SUCCESS" || !techPack.garmentAnalysisJson) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Generate a tech pack first before downloading it.");
  }

  // Pages 1/2/4 now typically share the SAME real attachment id -- fetch
  // each distinct one once rather than once per page.
  const distinctAttachmentIds = [...new Set(techPack.pages.map((p) => p.imageAttachmentId).filter((id): id is string => !!id))];
  const fetched = new Map<string, { imageBase64: string; imageMimeType: string }>();
  for (const attachmentId of distinctAttachmentIds) {
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, attachmentId);
    fetched.set(attachmentId, { imageBase64: buffer.toString("base64"), imageMimeType: attachment.mimeType });
  }

  const images: TechPackDocumentPageImage[] = techPack.pages
    .filter((p) => p.imageAttachmentId)
    .map((p) => ({ pageNumber: p.pageNumber, ...fetched.get(p.imageAttachmentId!)! }));

  const { renderTechPackDocumentPdf } = await import("@/core/ai-designer/export/tech-pack-pdf");
  const pdfBuffer = await renderTechPackDocumentPdf({
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    generatedAt: techPack.createdAt.toLocaleString(),
    analysis: techPack.garmentAnalysisJson as unknown as TechPackAnalysisForPdf,
    designerNotes: techPack.designerNotes ?? "",
    suggestedAdditionalViews: techPack.suggestedAdditionalViews ?? "",
    images,
  });

  return { buffer: pdfBuffer, mimeType: "application/pdf", fileName: `${project.projectNumber}-tech-pack.pdf` };
}

/**
 * Resolves a `{category, index?, field?}` path against a real
 * `GarmentAnalysis` object and returns the CURRENT string value there (for
 * the audit log's `oldValues`), without mutating anything. Shares the exact
 * same validation as `applyTechPackFieldEdit` below (any invalid path throws
 * the identical error), by simply calling that function with a sentinel
 * write and reading the result back out immediately afterward on a
 * throwaway clone -- see the two functions together.
 */
function readTechPackFieldValue(analysis: GarmentAnalysis, input: { category: string; index?: number; field?: string }): string | undefined {
  const { category, index, field } = input;
  try {
    switch (category) {
      case "identification":
        return (analysis.part1.identification as unknown as Record<string, string>)[field ?? ""];
      case "construction":
        return (analysis.part1.construction as unknown as Record<string, string>)[field ?? ""];
      case "closure":
        return (analysis.part1.closure as unknown as Record<string, string>)[field ?? ""];
      case "seamCallouts":
        return (analysis.part1.seamCallouts[index ?? -1] as unknown as Record<string, string>)[field ?? ""];
      case "visibleColors":
        return (analysis.part1.visibleColors[index ?? -1] as unknown as Record<string, string>)[field ?? ""];
      case "suggestedColorways":
        return (analysis.part1.suggestedColorways[index ?? -1] as unknown as Record<string, string>)[field ?? ""];
      case "artworkItems":
        return (analysis.part1.artworkItems[index ?? -1] as unknown as Record<string, string>)[field ?? ""];
      case "bomItems":
        return (analysis.part2.bomItems[index ?? -1] as unknown as Record<string, string>)[field ?? ""];
      case "measurementPoints": {
        const point = analysis.part2.measurementPoints[index ?? -1];
        if (!point) return undefined;
        if (field?.startsWith("values.")) return (point.values as unknown as Record<string, string>)[field.slice("values.".length)];
        return (point as unknown as Record<string, string>)[field ?? ""];
      }
      default:
        if ((PART1_SCALAR_FIELDS as readonly string[]).includes(category)) return (analysis.part1 as unknown as Record<string, string>)[category];
        if ((PART2_SCALAR_FIELDS as readonly string[]).includes(category)) return (analysis.part2 as unknown as Record<string, string>)[category];
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Resolves a `{category, index?, field?}` path against a mutable clone of
 * `GarmentAnalysis`, mutating the matching leaf in place with `value`.
 * Every category/field name is checked against the real known-key lists
 * exported from `tech-pack/schema.ts` -- an unknown key or out-of-bounds
 * array index is rejected outright, never silently written.
 */
function applyTechPackFieldEdit(analysis: GarmentAnalysis, input: { category: string; index?: number; field?: string; value: string }): void {
  const { category, index, field, value } = input;

  const requireIndex = (arr: unknown[]) => {
    if (index === undefined || index < 0 || index >= arr.length) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"${category}" requires a valid "index" (0-${arr.length - 1}).`);
    }
    return index;
  };
  const requireField = (allowed: readonly string[]) => {
    if (!field || !allowed.includes(field)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown field "${field}" for category "${category}".`);
    }
    return field;
  };

  switch (category) {
    case "identification": {
      const key = requireField(IDENTIFICATION_EDITABLE_FIELDS);
      (analysis.part1.identification as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "construction": {
      const key = requireField(CONSTRUCTION_EDITABLE_FIELDS);
      (analysis.part1.construction as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "closure": {
      const key = requireField(CLOSURE_EDITABLE_FIELDS);
      (analysis.part1.closure as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "seamCallouts": {
      const i = requireIndex(analysis.part1.seamCallouts);
      const item = analysis.part1.seamCallouts[i];
      if (field === "status") {
        if (!(SEAM_CALLOUT_STATUS_VALUES as readonly string[]).includes(value)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `"status" must be one of: ${SEAM_CALLOUT_STATUS_VALUES.join(", ")}.`);
        }
        item.status = value as (typeof SEAM_CALLOUT_STATUS_VALUES)[number];
        return;
      }
      const key = requireField(SEAM_CALLOUT_TEXT_FIELDS);
      (item as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "visibleColors": {
      const i = requireIndex(analysis.part1.visibleColors);
      const key = requireField(VISIBLE_COLOR_EDITABLE_FIELDS);
      (analysis.part1.visibleColors[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "suggestedColorways": {
      const i = requireIndex(analysis.part1.suggestedColorways);
      const key = requireField(SUGGESTED_COLORWAY_EDITABLE_FIELDS);
      (analysis.part1.suggestedColorways[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "artworkItems": {
      const i = requireIndex(analysis.part1.artworkItems);
      const key = requireField(ARTWORK_ITEM_EDITABLE_FIELDS);
      (analysis.part1.artworkItems[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "bomItems": {
      const i = requireIndex(analysis.part2.bomItems);
      const key = requireField(BOM_ITEM_EDITABLE_FIELDS);
      (analysis.part2.bomItems[i] as unknown as Record<string, string>)[key] = value;
      return;
    }
    case "measurementPoints": {
      const i = requireIndex(analysis.part2.measurementPoints);
      const point = analysis.part2.measurementPoints[i];
      if (field?.startsWith("values.")) {
        const size = field.slice("values.".length);
        if (!(STANDARD_SIZES as readonly string[]).includes(size)) {
          throw new BusinessRuleError("VALIDATION_ERROR", `Unknown size "${size}" — must be one of: ${STANDARD_SIZES.join(", ")}.`);
        }
        (point.values as unknown as Record<string, string>)[size] = value;
        return;
      }
      const key = requireField(MEASUREMENT_POINT_EDITABLE_FIELDS);
      (point as unknown as Record<string, string>)[key] = value;
      return;
    }
    default: {
      // The 9 remaining categories are plain scalar strings on Part 1/Part 2
      // -- the whole value is replaced directly, no field/index involved.
      if ((PART1_SCALAR_FIELDS as readonly string[]).includes(category)) {
        (analysis.part1 as unknown as Record<string, string>)[category] = value;
        return;
      }
      if ((PART2_SCALAR_FIELDS as readonly string[]).includes(category)) {
        (analysis.part2 as unknown as Record<string, string>)[category] = value;
        return;
      }
      throw new BusinessRuleError("VALIDATION_ERROR", `Unknown tech pack category "${category}".`);
    }
  }
}

/**
 * Edits one field/row of a Tech Pack's Garment Analysis. Editing an
 * already-APPROVED tech pack never mutates it -- it forks a brand-new
 * revision row first (same real data, same real page image ids, no
 * re-upload) and applies the edit to THAT row instead, so a previously-
 * approved, previously-downloaded PDF's data always stays exactly
 * reproducible. Editing a still-DRAFT tech pack just updates it in place.
 */
export async function updateTechPackField(actor: ActorContext, projectId: string, techPackId: string, input: UpdateTechPackFieldInput) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId || !techPack.garmentAnalysisJson) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }

  let target = techPack;
  if (techPack.approvalStatus === "APPROVED") {
    target = await AiDesignerTechPackRepository.createRevision({
      id: techPack.id,
      companyId: techPack.companyId,
      projectId: techPack.projectId,
      garmentAnalysisJson: techPack.garmentAnalysisJson as Prisma.InputJsonValue,
      originalGarmentAnalysisJson: (techPack.originalGarmentAnalysisJson ?? techPack.garmentAnalysisJson) as Prisma.InputJsonValue,
      designerNotes: techPack.designerNotes,
      suggestedAdditionalViews: techPack.suggestedAdditionalViews,
      revisionNumber: techPack.revisionNumber,
      createdByUserId: actor.userId,
      pages: techPack.pages.map((p) => ({ pageNumber: p.pageNumber, pageTitle: p.pageTitle, promptText: p.promptText, imageAttachmentId: p.imageAttachmentId })),
    });
  }

  const analysis = JSON.parse(JSON.stringify(target.garmentAnalysisJson)) as GarmentAnalysis;
  const oldValue = readTechPackFieldValue(analysis, input);
  applyTechPackFieldEdit(analysis, input);

  const updated = await AiDesignerTechPackRepository.update(target.id, {
    garmentAnalysisJson: analysis as unknown as Prisma.InputJsonValue,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: target.id,
    action: "UPDATE",
    oldValues: { category: input.category, index: input.index, field: input.field, forkedFrom: target.id !== techPack.id ? techPack.id : undefined, value: oldValue },
    newValues: { category: input.category, index: input.index, field: input.field, value: input.value },
  });

  return { techPack: updated, forkedNewRevision: target.id !== techPack.id };
}

/** Approve — mirrors AiDesignerVersion's own approvalStatus/approvedByUserId/approvedAt pattern exactly. */
export async function approveTechPack(actor: ActorContext, projectId: string, techPackId: string) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }
  if (techPack.status !== "SUCCESS") {
    throw new BusinessRuleError("VALIDATION_ERROR", "Only a successfully generated tech pack can be approved.");
  }

  await PermissionService.assert(actor.userId, "ai_designer", "approve", { createdBy: techPack.createdByUserId });

  const updated = await AiDesignerTechPackRepository.update(techPackId, {
    approvalStatus: "APPROVED",
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: techPackId,
    action: "UPDATE",
    oldValues: { approvalStatus: techPack.approvalStatus },
    newValues: { approvalStatus: "APPROVED" },
  });

  return updated;
}

/** Discards every edit made since generation, restoring the frozen AI-original snapshot. Blocked once approved -- an approved tech pack's own data is the record; further edits fork a new revision instead (see updateTechPackField). */
export async function revertTechPackToOriginal(actor: ActorContext, projectId: string, techPackId: string) {
  await getOwnedProject(actor.companyId, projectId);
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId) {
    throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  }
  if (techPack.approvalStatus === "APPROVED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This tech pack is already approved — it cannot be reverted.");
  }
  if (!techPack.originalGarmentAnalysisJson) {
    throw new BusinessRuleError("VALIDATION_ERROR", "No AI-generated original is available to revert to.");
  }

  const updated = await AiDesignerTechPackRepository.update(techPackId, {
    garmentAnalysisJson: techPack.originalGarmentAnalysisJson as Prisma.InputJsonValue,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: techPackId,
    action: "UPDATE",
    newValues: { revertedToOriginal: true },
  });

  return updated;
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

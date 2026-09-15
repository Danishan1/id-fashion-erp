import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber, advanceMasterCodeSequence } from "@/core/numbering/DocumentNumberingService";
import type { ListQuery } from "@/lib/list-query";
import { todayIsoDate } from "@/lib/date";
import { createSampleRequest } from "@/modules/sampling/sample.service";
import { SalesOrderRepository } from "@/modules/sales-orders/sales-order.repository";
import { CustomerRepository } from "@/modules/customers/customer.repository";
import { ProductRepository } from "@/modules/products/product.repository";
import { SupplierRepository } from "@/modules/suppliers/supplier.repository";
import { GarmentAttributeRepository } from "@/modules/garment-attributes/garment-attributes.repository";
import { FabricConfigRepository } from "@/modules/fabric-config/fabric-config.repository";
import { LookupRepository } from "@/modules/lookups/lookup.repository";
import {
  AiGarmentDesignOptionRepository,
  AiGarmentFabricDetailRepository,
  AiGarmentProjectRepository,
} from "./ai-garment-project.repository";
import { AiGarmentReferenceAnalysisRepository } from "./reference-analysis.repository";
import { AiGarmentFabricAnalysisRepository } from "./fabric-analysis.repository";
import { AiGarmentProductSuitabilityRepository } from "./product-suitability.repository";
import { AiGarmentDesignDirectionRepository } from "./development-brief.repository";
import {
  stepsForSourceType,
  type AiGarmentProjectInput,
  type AiGarmentProjectUpdateInput,
  type ConvertProjectToStyleInput,
  type CreateDesignOptionInput,
  type CreateSampleRequestFromProjectInput,
  type FabricDetailInput,
  type LinkSalesOrderToProjectInput,
  type SaveWorkflowStepInput,
} from "./ai-garment-project.schema";
import { AiGarmentProjectStatus, type Prisma } from "@prisma/client";

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

interface ProjectFilters {
  status?: AiGarmentProjectStatus;
  sourceType?: "REFERENCE" | "FABRIC";
  customerId?: string;
  brandId?: string;
  seasonId?: string;
  categoryId?: string;
  createdByUserId?: string;
}

/**
 * A status is never allowed to regress when a later workflow step is saved
 * (revisiting an earlier step for a correction must not un-advance a
 * project that has genuinely moved on) — this ordering is what
 * "further along than the current status" is checked against.
 */
const STATUS_ORDER: AiGarmentProjectStatus[] = [
  "IDEA",
  "REFERENCE_ANALYSIS",
  "DESIGN_DEVELOPMENT",
  "DESIGN_SELECTED",
  "TECHNICAL_DEVELOPMENT",
  "COSTING",
  "SAMPLING",
  "BUYER_REVIEW",
  "APPROVED",
  "PRODUCTION",
  "COMPLETED",
];

const TERMINAL_STATUSES: AiGarmentProjectStatus[] = ["COMPLETED", "REJECTED", "CANCELLED"];

/**
 * Maps a workflow step to the coarse milestone status reaching it implies.
 * Steps with no direct status of their own (e.g. UPLOAD_REFERENCE) simply
 * don't advance the status past whatever it already is. FABRIC_ANALYSIS
 * deliberately reuses REFERENCE_ANALYSIS's status value — the user's own
 * requested status list is one shared vocabulary across both workflows, not
 * source-type-specific.
 */
const STEP_TO_STATUS: Partial<Record<string, AiGarmentProjectStatus>> = {
  REFERENCE_ANALYSIS: "REFERENCE_ANALYSIS",
  FABRIC_ANALYSIS: "REFERENCE_ANALYSIS",
  DEVELOPMENT_BRIEF: "DESIGN_DEVELOPMENT",
  GENERATE_VARIATIONS: "DESIGN_DEVELOPMENT",
  PRODUCT_SUITABILITY: "DESIGN_DEVELOPMENT",
  PRODUCT_DIRECTIONS: "DESIGN_DEVELOPMENT",
  GENERATE_DESIGNS: "DESIGN_DEVELOPMENT",
  COMMERCIAL_EVALUATION: "DESIGN_DEVELOPMENT",
  SELECT_DESIGN: "DESIGN_SELECTED",
  APPLY_FABRIC: "DESIGN_SELECTED",
  TECHNICAL_DEVELOPMENT: "TECHNICAL_DEVELOPMENT",
  BOM: "TECHNICAL_DEVELOPMENT",
  COSTING: "COSTING",
  // Entering this step means the physical sample is now in progress. The
  // BUYER_REVIEW/APPROVED sub-states within it are never reached via a step
  // save at all -- they're derived live from the linked SampleRequest's own
  // real status by getAiGarmentProjectById() (see deriveStatusFromSample()
  // below), since that decision happens entirely inside Sampling's own
  // workflow, outside this wizard's control.
  SAMPLING_REVIEW: "SAMPLING",
  PRODUCTION: "PRODUCTION",
};

/**
 * SAMPLING/BUYER_REVIEW/APPROVED aren't reached by saving a step -- they
 * happen inside Sampling's own state machine, entirely outside this
 * wizard's control (see recordSampleApproval() in sample.service.ts). This
 * derives the correct AiGarmentProjectStatus from the linked SampleRequest's
 * own real status, the same "derive real state, never trust a stored label
 * that can drift" discipline this project has used since Sampling's own
 * Hold/Resume bug. Returns null when no confident mapping applies (DRAFT/
 * ON_HOLD/CANCELLED-before-ever-submitting) so the caller leaves the current
 * status untouched rather than guessing.
 */
function deriveStatusFromSampleStatus(sampleStatus: string): AiGarmentProjectStatus | null {
  switch (sampleStatus) {
    case "REQUESTED":
    case "TECH_PACK_READY":
    case "IN_DEVELOPMENT":
    case "INTERNAL_QC":
      return "SAMPLING";
    case "SUBMITTED_TO_CUSTOMER":
    case "CUSTOMER_FEEDBACK_RECEIVED":
    case "REVISION_REQUESTED":
      return "BUYER_REVIEW";
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      // The sample's own CANCELLED status is deliberately NOT mapped here --
      // a cancelled Sample Request doesn't mean the project itself is
      // rejected (the merchandiser may raise a fresh one), whereas a real
      // buyer REJECTED decision does end this project's own path forward.
      return "REJECTED";
    default:
      return null;
  }
}

function nextStatusForStep(current: AiGarmentProjectStatus, stepKey: string): AiGarmentProjectStatus {
  const mapped = STEP_TO_STATUS[stepKey];
  if (!mapped) return current;
  const currentIdx = STATUS_ORDER.indexOf(current);
  const mappedIdx = STATUS_ORDER.indexOf(mapped);
  return mappedIdx > currentIdx ? mapped : current;
}

async function assertOptionalFksBelongToCompany(
  companyId: string,
  fields: { customerId?: string; buyerId?: string; brandId?: string; seasonId?: string; categoryId?: string }
) {
  let customer: Awaited<ReturnType<typeof CustomerRepository.findByIdWithBuyers>> = null;
  if (fields.customerId) {
    customer = await CustomerRepository.findByIdWithBuyers(companyId, fields.customerId);
    if (!customer) throw new BusinessRuleError("NOT_FOUND", "Customer not found.", { id: fields.customerId });
  }
  if (fields.buyerId && !customer?.buyers.some((b) => b.id === fields.buyerId)) {
    throw new BusinessRuleError("NOT_FOUND", "Buyer not found for this customer.", { id: fields.buyerId });
  }
  if (fields.brandId) {
    const brand = await GarmentAttributeRepository.brand.findFirst({ where: { id: fields.brandId, companyId } });
    if (!brand) throw new BusinessRuleError("NOT_FOUND", "Brand not found.", { id: fields.brandId });
  }
  if (fields.seasonId) {
    const season = await GarmentAttributeRepository.season.findFirst({ where: { id: fields.seasonId, companyId } });
    if (!season) throw new BusinessRuleError("NOT_FOUND", "Season not found.", { id: fields.seasonId });
  }
  if (fields.categoryId) {
    const category = await GarmentAttributeRepository.category.findFirst({ where: { id: fields.categoryId, companyId } });
    if (!category) throw new BusinessRuleError("NOT_FOUND", "Category not found.", { id: fields.categoryId });
  }
}

export async function listAiGarmentProjects(companyId: string, query: ListQuery, filters: ProjectFilters = {}) {
  const where: Prisma.AiGarmentProjectWhereInput = {
    companyId,
    ...(query.search
      ? {
          OR: [
            { projectNumber: { contains: query.search, mode: "insensitive" as const } },
            { projectName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.sourceType ? { sourceType: filters.sourceType } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.seasonId ? { seasonId: filters.seasonId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.createdByUserId ? { createdByUserId: filters.createdByUserId } : {}),
  };

  const [data, totalCount] = await Promise.all([
    AiGarmentProjectRepository.findMany(where, {
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
    }),
    AiGarmentProjectRepository.count(where),
  ]);

  return { data, totalCount };
}

export async function getAiGarmentProjectById(companyId: string, id: string) {
  let project = await AiGarmentProjectRepository.findByIdWithDetails(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });

  // Self-healing derivation at read time, the same "never trust a stored
  // label that can silently drift from real state" discipline already
  // proven by SubmoduleVisibility's own locking logic — only while genuinely
  // in-flight (SAMPLING/BUYER_REVIEW), never touching a status this project
  // has already moved past on its own (APPROVED/COMPLETED/REJECTED/etc.).
  if (project.sampleRequest && (project.status === "SAMPLING" || project.status === "BUYER_REVIEW")) {
    const derived = deriveStatusFromSampleStatus(project.sampleRequest.status);
    if (derived && derived !== project.status) {
      await AiGarmentProjectRepository.update(id, { status: derived });
      project = (await AiGarmentProjectRepository.findByIdWithDetails(companyId, id)) ?? project;
    }
  }

  return project;
}

export async function createAiGarmentProject(actor: ActorContext, input: AiGarmentProjectInput) {
  await assertOptionalFksBelongToCompany(actor.companyId, input);

  const projectNumber = await generateDocumentNumber({
    companyId: actor.companyId,
    branchId: actor.branchId ?? null,
    documentType: "AI_GARMENT_PROJECT",
  });

  const steps = stepsForSourceType(input.sourceType);

  const project = await AiGarmentProjectRepository.create({
    companyId: actor.companyId,
    branchId: actor.branchId || null,
    projectNumber,
    projectName: input.projectName,
    sourceType: input.sourceType,
    customerId: input.customerId || null,
    buyerId: input.buyerId || null,
    brandId: input.brandId || null,
    seasonId: input.seasonId || null,
    categoryId: input.categoryId || null,
    targetMarket: input.targetMarket || null,
    targetCustomerProfile: input.targetCustomerProfile || null,
    targetSellingPrice: input.targetSellingPrice ?? null,
    currencyCode: input.currencyCode || null,
    orderQuantityEstimate: input.orderQuantityEstimate ?? null,
    notes: input.notes || null,
    status: "IDEA",
    currentStepKey: steps[0].key,
    completedStepKeys: [],
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: project.id,
    action: "CREATE",
    newValues: { projectNumber: project.projectNumber, sourceType: project.sourceType },
  });

  return project;
}

function assertNotTerminal(project: { status: AiGarmentProjectStatus }) {
  if (TERMINAL_STATUSES.includes(project.status)) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `This project is "${project.status}" and can no longer be changed.`,
      { status: project.status }
    );
  }
}

export async function updateAiGarmentProject(actor: ActorContext, id: string, input: AiGarmentProjectUpdateInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  assertNotTerminal(project);

  await assertOptionalFksBelongToCompany(actor.companyId, input);

  const updated = await AiGarmentProjectRepository.update(id, {
    ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId || null } : {}),
    ...(input.buyerId !== undefined ? { buyerId: input.buyerId || null } : {}),
    ...(input.brandId !== undefined ? { brandId: input.brandId || null } : {}),
    ...(input.seasonId !== undefined ? { seasonId: input.seasonId || null } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
    ...(input.targetMarket !== undefined ? { targetMarket: input.targetMarket || null } : {}),
    ...(input.targetCustomerProfile !== undefined ? { targetCustomerProfile: input.targetCustomerProfile || null } : {}),
    ...(input.targetSellingPrice !== undefined ? { targetSellingPrice: input.targetSellingPrice ?? null } : {}),
    ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode || null } : {}),
    ...(input.orderQuantityEstimate !== undefined ? { orderQuantityEstimate: input.orderQuantityEstimate ?? null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "UPDATE",
    newValues: input,
  });

  return updated;
}

/**
 * Saves the wizard's current position (the "save and leave, resume later"
 * requirement) and derives a coarse status advance from it — never a
 * regression, per nextStatusForStep's own ordering guard.
 */
export async function saveWorkflowStep(actor: ActorContext, id: string, input: SaveWorkflowStepInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  assertNotTerminal(project);
  if (project.status === "ON_HOLD") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Resume this project before continuing its workflow.", {
      status: project.status,
    });
  }

  const steps = stepsForSourceType(project.sourceType);
  const validKeys = new Set(steps.map((s) => s.key));
  if (!validKeys.has(input.stepKey)) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      `"${input.stepKey}" is not a step of the ${project.sourceType} workflow.`,
      { stepKey: input.stepKey, sourceType: project.sourceType }
    );
  }

  // Both Process 2 gates below are keyed on the TARGET step's position in the
  // sequence, not on an exact from->to transition match. The stepper lets a
  // user click any step directly (not just "Save & Continue" to the very next
  // one), so a transition-shaped check (e.g. "currentStepKey === X && stepKey
  // === Y") can be bypassed simply by jumping two steps at once — landing on
  // stepKey Z instead of Y skips a check that only ever looks for Y. Checking
  // "is the destination at-or-past the gated step" instead closes that
  // regardless of the current step or how many steps are being skipped at once.
  const developmentBriefIndex = steps.findIndex((s) => s.key === "DEVELOPMENT_BRIEF");
  const targetIndex = steps.findIndex((s) => s.key === input.stepKey);

  // Process 2 (Development Brief) starts only once the Reference Garment
  // Analysis has been approved — checked here, not just left as a UI
  // affordance, so a direct API call can't skip the gate either. Applies to
  // DEVELOPMENT_BRIEF itself and to jumping straight past it.
  if (developmentBriefIndex !== -1 && targetIndex >= developmentBriefIndex) {
    const analysis = await AiGarmentReferenceAnalysisRepository.findByProjectId(id);
    if (!analysis || analysis.status !== "APPROVED") {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "Approve the Reference Garment Analysis before starting the Development Brief.",
        { analysisStatus: analysis?.status ?? "DRAFT" }
      );
    }
  }

  // The "APPROVE DESIGN DIRECTIONS" final button is this same generic
  // advance, gated on at least one individually-approved design direction
  // existing whenever the destination is any step after DEVELOPMENT_BRIEF —
  // not only the immediate next one.
  if (developmentBriefIndex !== -1 && targetIndex > developmentBriefIndex) {
    const approvedCount = await AiGarmentDesignDirectionRepository.countByStatus(id, "APPROVED");
    if (approvedCount === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "Approve at least one design direction before continuing past the Development Brief."
      );
    }
  }

  // Process 7's own gate, the Fabric-workflow's mirror of the two above:
  // PRODUCT_SUITABILITY only exists in AI_GARMENT_FABRIC_STEPS, so
  // productSuitabilityIndex is -1 (and this whole block a no-op) for a
  // REFERENCE-sourced project, the same "findIndex returns -1 on the other
  // workflow's own steps" idiom the developmentBriefIndex check above
  // already relies on.
  const productSuitabilityIndex = steps.findIndex((s) => s.key === "PRODUCT_SUITABILITY");
  if (productSuitabilityIndex !== -1 && targetIndex >= productSuitabilityIndex) {
    const fabricAnalysis = await AiGarmentFabricAnalysisRepository.findByProjectId(id);
    if (!fabricAnalysis || fabricAnalysis.status !== "APPROVED") {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "Approve the Fabric Analysis before continuing to Product Suitability.",
        { analysisStatus: fabricAnalysis?.status ?? "DRAFT" }
      );
    }
  }

  // The user's own process 8 (Product/Fabric Suitability)'s own gate,
  // mirroring the one above exactly, one step further down the FABRIC
  // workflow: PRODUCT_DIRECTIONS only exists in AI_GARMENT_FABRIC_STEPS, so
  // productDirectionsIndex is -1 (and this whole block a no-op) for a
  // REFERENCE-sourced project, the same idiom used throughout this function.
  const productDirectionsIndex = steps.findIndex((s) => s.key === "PRODUCT_DIRECTIONS");
  if (productDirectionsIndex !== -1 && targetIndex >= productDirectionsIndex) {
    const suitability = await AiGarmentProductSuitabilityRepository.findByProjectId(id);
    if (!suitability || suitability.status !== "APPROVED") {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "Approve the Product Suitability assessment before continuing to Product Directions.",
        { analysisStatus: suitability?.status ?? "DRAFT" }
      );
    }
  }

  // The user's own process 9 (Fabric-to-Garment Development)'s own gate,
  // mirroring the DEVELOPMENT_BRIEF "at least one approved design direction"
  // gate above exactly, for the FABRIC workflow's own equivalent step.
  if (productDirectionsIndex !== -1 && targetIndex > productDirectionsIndex) {
    const approvedCount = await AiGarmentDesignDirectionRepository.countByStatus(id, "APPROVED");
    if (approvedCount === 0) {
      throw new BusinessRuleError(
        "INVALID_STATE_TRANSITION",
        "Approve at least one design direction before continuing past Product Directions."
      );
    }
  }

  const completedStepKeys = project.completedStepKeys.includes(input.stepKey)
    ? project.completedStepKeys
    : [...project.completedStepKeys, input.stepKey];

  const updated = await AiGarmentProjectRepository.update(id, {
    currentStepKey: input.stepKey,
    completedStepKeys,
    status: nextStatusForStep(project.status, input.stepKey),
  });

  return updated;
}

export async function holdProject(actor: ActorContext, id: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (project.status === "ON_HOLD" || TERMINAL_STATUSES.includes(project.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot hold a project in "${project.status}" status.`, {
      status: project.status,
    });
  }

  const updated = await AiGarmentProjectRepository.update(id, {
    status: "ON_HOLD",
    statusBeforeHold: project.status,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: project.status },
    newValues: { status: "ON_HOLD" },
  });

  return updated;
}

export async function resumeProject(actor: ActorContext, id: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (project.status !== "ON_HOLD" || !project.statusBeforeHold) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This project is not currently on hold.", {
      status: project.status,
    });
  }

  const updated = await AiGarmentProjectRepository.update(id, {
    status: project.statusBeforeHold,
    statusBeforeHold: null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "UPDATE",
    oldValues: { status: "ON_HOLD" },
    newValues: { status: updated.status },
  });

  return updated;
}

export async function cancelProject(actor: ActorContext, id: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (TERMINAL_STATUSES.includes(project.status)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a project in "${project.status}" status.`, {
      status: project.status,
    });
  }

  const updated = await AiGarmentProjectRepository.update(id, { status: "CANCELLED", statusBeforeHold: null });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: project.status },
    newValues: { status: "CANCELLED" },
  });

  return updated;
}

export async function upsertFabricDetail(actor: ActorContext, projectId: string, input: FabricDetailInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  assertNotTerminal(project);

  const { companyId } = actor;
  if (input.gsmId && !(await FabricConfigRepository.gsm.findFirst({ where: { id: input.gsmId, companyId } }))) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric GSM not found.", { id: input.gsmId });
  }
  if (input.dyeId && !(await FabricConfigRepository.dye.findFirst({ where: { id: input.dyeId, companyId } }))) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric dye/shade not found.", { id: input.dyeId });
  }
  if (
    input.weaveTypeId &&
    !(await FabricConfigRepository.weaveType.findFirst({ where: { id: input.weaveTypeId, companyId } }))
  ) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric weave type not found.", { id: input.weaveTypeId });
  }
  if (input.widthId && !(await FabricConfigRepository.width.findFirst({ where: { id: input.widthId, companyId } }))) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric width not found.", { id: input.widthId });
  }
  if (
    input.compositionId &&
    !(await FabricConfigRepository.composition.findFirst({ where: { id: input.compositionId, companyId } }))
  ) {
    throw new BusinessRuleError("NOT_FOUND", "Fabric composition not found.", { id: input.compositionId });
  }
  if (input.colorId && !(await LookupRepository.color.findFirst({ where: { id: input.colorId, companyId } }))) {
    throw new BusinessRuleError("NOT_FOUND", "Color not found.", { id: input.colorId });
  }
  if (input.supplierId && !(await SupplierRepository.findById(companyId, input.supplierId))) {
    throw new BusinessRuleError("NOT_FOUND", "Supplier not found.", { id: input.supplierId });
  }

  const detail = await AiGarmentFabricDetailRepository.upsert(projectId, {
    gsmId: input.gsmId || null,
    dyeId: input.dyeId || null,
    weaveTypeId: input.weaveTypeId || null,
    widthId: input.widthId || null,
    compositionId: input.compositionId || null,
    colorId: input.colorId || null,
    supplierId: input.supplierId || null,
    notes: input.notes || null,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_fabric_details",
    recordId: detail.id,
    action: "UPDATE",
    newValues: input,
  });

  return detail;
}

export async function addDesignOption(actor: ActorContext, projectId: string, input: CreateDesignOptionInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id: projectId });
  assertNotTerminal(project);

  const option = await AiGarmentDesignOptionRepository.create({
    projectId,
    label: input.label || null,
    notes: input.notes || null,
    createdByUserId: actor.userId,
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_design_options",
    recordId: option.id,
    action: "CREATE",
    newValues: { label: option.label },
  });

  return option;
}

export async function selectDesignOption(actor: ActorContext, optionId: string) {
  const option = await AiGarmentDesignOptionRepository.findWithProjectOwner(optionId);
  if (!option || option.project.companyId !== actor.companyId) {
    throw new BusinessRuleError("NOT_FOUND", "Design option not found.", { id: optionId });
  }
  assertNotTerminal(option.project);

  const updated = await AiGarmentDesignOptionRepository.selectExclusive(option.projectId, optionId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_design_options",
    recordId: optionId,
    action: "UPDATE",
    newValues: { isSelected: true },
  });

  return updated;
}

/**
 * Graduates the project into a real Style. Deliberately one-way and manual
 * — mirrors convertSampleToStyle() exactly (same style-code uniqueness
 * check, same advanceMasterCodeSequence() call, same single-shot guarded
 * FK write), so an abandoned/rejected AI Garment Flow project never
 * silently clutters the Styles catalog.
 */
export async function convertProjectToStyle(actor: ActorContext, id: string, input: ConvertProjectToStyleInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });

  if (STATUS_ORDER.indexOf(project.status) < STATUS_ORDER.indexOf("DESIGN_SELECTED")) {
    throw new BusinessRuleError(
      "INVALID_STATE_TRANSITION",
      `A design must be selected before converting to a Style, not "${project.status}".`,
      { status: project.status }
    );
  }

  if (project.productId) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This project is already linked to a Style.", {
      productId: project.productId,
    });
  }

  const codeInUse = await ProductRepository.findByStyleCode(actor.companyId, input.styleCode);
  if (codeInUse) {
    throw new BusinessRuleError("DUPLICATE_DOC_NUMBER", `Style code "${input.styleCode}" is already in use.`);
  }

  const product = await ProductRepository.create({
    companyId: actor.companyId,
    itemType: "STYLE",
    styleCode: input.styleCode,
    styleName: input.styleName,
    categoryId: input.categoryId || project.categoryId || null,
    seasonId: input.seasonId || project.seasonId || null,
    brandId: input.brandId || project.brandId || null,
    gender: input.gender || null,
    description: input.description || null,
    hsnSacCode: input.hsnSacCode || null,
    customerId: project.customerId,
    isActive: true,
  });

  await advanceMasterCodeSequence(actor.companyId, "STYLE");

  const guarded = await AiGarmentProjectRepository.setProductIdGuarded(id, product.id);
  if (guarded.count === 0) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This project was converted by another request just now — the Style created here was not linked and can be discarded.",
      { id, orphanedProductId: product.id }
    );
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "products",
    recordId: product.id,
    action: "CREATE",
    newValues: product,
  });

  const updated = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  return { product, project: updated };
}

/**
 * The one and only place an AiGarmentProject ever becomes linked to a real
 * SampleRequest. Deliberately reuses createSampleRequest() from the
 * Sampling module completely unchanged — the exact same reuse pattern
 * convertEnquiryLineToSampleRequest() already uses. A concurrent
 * double-create is closed with a guarded conditional update; if it loses
 * the race, the SampleRequest already created is left as a harmless orphan
 * rather than double-linking the project.
 */
export async function createSampleRequestFromProject(
  actor: ActorContext,
  id: string,
  input: CreateSampleRequestFromProjectInput
) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });

  if (!project.productId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Convert this project to a Style before creating a Sample Request from it."
    );
  }
  if (project.sampleRequestId) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This project already has a linked Sample Request.",
      { sampleRequestId: project.sampleRequestId }
    );
  }
  if (!project.customerId) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "This project has no linked Customer — link a real Customer before creating a Sample Request from it."
    );
  }

  // Note: `input.color` (a free-text value) is deliberately NOT threaded
  // through here — Sample Request's own color/size are now real Color/Size
  // master FKs (2026-09-15), and a free-text value has no reliable match to
  // pick from automatically. The merchandiser picks the real color/size on
  // the created sample request directly afterward, same as any other sample.
  const sampleRequest = await createSampleRequest(actor, {
    customerId: project.customerId,
    buyerId: project.buyerId || undefined,
    productId: project.productId,
    styleName: project.projectName,
    sampleType: input.sampleType,
    requestDate: todayIsoDate(),
    targetSubmissionDate: input.targetSubmissionDate || undefined,
  });

  const guarded = await AiGarmentProjectRepository.setSampleRequestIdGuarded(id, sampleRequest.id);
  if (guarded.count === 0) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This project was linked by another request just now — the sample request created here was not linked and can be discarded.",
      { id, orphanedSampleRequestId: sampleRequest.id }
    );
  }

  const updated = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  return { project: updated, sampleRequest };
}

/**
 * "Continue to Production" — SAMPLING_REVIEW's own advance. Re-fetches
 * through getAiGarmentProjectById() first so the derived status (see
 * deriveStatusFromSampleStatus above) is freshest before gating on it,
 * rather than trusting a possibly-stale value the caller already had.
 * Requires the real, derived "APPROVED" status — never a separate stored
 * flag — the same "gate on the real fact, not a label" discipline
 * completeBomStep()/completeCostingStep() already established for
 * Bom.approvedVersionId/SampleVersion.finalTotal.
 */
export async function completeSamplingReviewStep(actor: ActorContext, id: string) {
  const project = await getAiGarmentProjectById(actor.companyId, id);
  if (project.status !== "APPROVED") {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "The buyer must approve the sample (recorded on the Sample Request's own detail page) before continuing to Production.",
      { status: project.status }
    );
  }

  await saveWorkflowStep(actor, id, { stepKey: "SAMPLING_REVIEW" });

  const steps = stepsForSourceType(project.sourceType);
  const currentIndex = steps.findIndex((s) => s.key === "SAMPLING_REVIEW");
  const nextStep = steps[currentIndex + 1];
  if (nextStep) {
    await saveWorkflowStep(actor, id, { stepKey: nextStep.key });
  }

  return AiGarmentProjectRepository.findAnyById(actor.companyId, id);
}

/**
 * Links an already-created Sales Order back to this project. Sales Order
 * creation itself is never reimplemented here — see the schema comment on
 * linkSalesOrderToProjectSchema for why (real commercial input the AI
 * Garment Flow wizard can't sensibly default). A concurrent double-link
 * attempt is closed two ways: setSalesOrderIdGuarded's own `where` clause
 * (re-asserts "still unlinked" on THIS project) plus the DB's own `@unique`
 * constraint on AiGarmentProject.salesOrderId (a P2002 if a second project
 * tries to claim an order already linked elsewhere) — caught and mapped to
 * a clean error rather than a raw 500.
 */
export async function linkSalesOrderToProject(actor: ActorContext, id: string, input: LinkSalesOrderToProjectInput) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (project.salesOrderId) {
    throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This project already has a linked Sales Order.", {
      salesOrderId: project.salesOrderId,
    });
  }

  const salesOrder = await SalesOrderRepository.findAnyById(actor.companyId, input.salesOrderId);
  if (!salesOrder) throw new BusinessRuleError("NOT_FOUND", "Sales Order not found.", { id: input.salesOrderId });

  let guarded: { count: number };
  try {
    guarded = await AiGarmentProjectRepository.setSalesOrderIdGuarded(id, salesOrder.id);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      throw new BusinessRuleError("REFERENCED_RECORD_IN_USE", "This Sales Order is already linked to a different AI Garment Flow project.", {
        salesOrderId: salesOrder.id,
      });
    }
    throw err;
  }
  if (guarded.count === 0) {
    throw new BusinessRuleError(
      "REFERENCED_RECORD_IN_USE",
      "This project was linked by another request just now.",
      { id }
    );
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "UPDATE",
    newValues: { salesOrderId: salesOrder.id },
  });

  return AiGarmentProjectRepository.findAnyById(actor.companyId, id);
}

/**
 * Derives "has real production actually started" purely from ProductionOrder
 * itself (via countActiveProductionOrdersForSalesOrder) — never a stored
 * flag on this project. Empty/false, not an error, whenever no Sales Order
 * is linked yet, matching every other AI Garment Flow read endpoint's own
 * empty-state convention.
 */
export async function getProductionStatusForProject(companyId: string, id: string) {
  const project = await AiGarmentProjectRepository.findAnyById(companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (!project.salesOrderId) return { hasSalesOrder: false, hasProductionOrder: false };

  const count = await AiGarmentProjectRepository.countActiveProductionOrdersForSalesOrder(project.salesOrderId);
  return { hasSalesOrder: true, hasProductionOrder: count > 0 };
}

/**
 * "Mark Project Complete" — PRODUCTION's own advance, and this project's
 * real terminal milestone (see productionHandoffCompletedAt's schema
 * comment). Requires a real Sales Order linked AND at least one real,
 * non-cancelled Production Order to already exist for it — the exact
 * "gate on the next real module's own meaningful state, never a client-side
 * count" discipline completeBomStep()/completeCostingStep() already
 * established. Once real, the project genuinely leaves this wizard's own
 * scope — Production's own Lot/JobOrder/QC lifecycle takes over entirely
 * inside the existing Production module, unchanged.
 */
export async function completeProjectWorkflow(actor: ActorContext, id: string) {
  const project = await AiGarmentProjectRepository.findAnyById(actor.companyId, id);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });
  if (!project.salesOrderId) {
    throw new BusinessRuleError("VALIDATION_ERROR", "Link a Sales Order to this project before marking it complete.");
  }

  const productionCount = await AiGarmentProjectRepository.countActiveProductionOrdersForSalesOrder(project.salesOrderId);
  if (productionCount === 0) {
    throw new BusinessRuleError(
      "VALIDATION_ERROR",
      "Create a real Production Order for this style (in the Production module) before marking this project complete."
    );
  }

  await saveWorkflowStep(actor, id, { stepKey: "PRODUCTION" });
  await AiGarmentProjectRepository.markProductionHandoffComplete(id, actor.userId);

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_garment_projects",
    recordId: id,
    action: "UPDATE",
    newValues: { status: "COMPLETED" },
  });

  return AiGarmentProjectRepository.findAnyById(actor.companyId, id);
}

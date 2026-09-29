import type { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getAttachmentForDownload, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiConfigMissingError } from "@/core/ai/config";
import { AiInvalidResponseError, AiServiceError } from "@/core/ai/providers/anthropic";
import { runWithFailover } from "@/core/ai/provider-manager/AIProviderManager";
import { ImageGenerationServiceError } from "@/core/ai/image-generation/types";
import { logger } from "@/core/logging/logger";
import { TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { analyzeGarmentForTechPack } from "@/core/ai-designer/tech-pack-master/analyze";
import { buildTechPackPagePrompts } from "@/core/ai-designer/tech-pack-master/page-prompts";
import { isMasterTechPackJson, masterAnalysisSchema, pageMode, type MasterAnalysis, type MasterTechPackJson } from "@/core/ai-designer/tech-pack-master/schema";
import { AiDesignerProjectRepository, AiDesignerTechPackRepository } from "./ai-designer.repository";

interface ActorContext {
  companyId: string;
  userId: string;
}

/** A full 7-page run can take several minutes; an IN_PROGRESS page older than this is treated as abandoned. */
const PAGE_RUN_STALE_MS = 10 * 60 * 1000;
/** Pages generated at the same time — keeps within provider rate limits while not taking 7× as long. */
const PAGE_CONCURRENCY = 2;

function toMediaType(mimeType: string): "image/jpeg" | "image/png" | "image/webp" {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "image/jpeg";
  if (mimeType === "image/webp") return "image/webp";
  return "image/png";
}

async function getProjectWithImage(companyId: string, projectId: string) {
  const project = await AiDesignerProjectRepository.findByIdWithDetails(companyId, projectId);
  if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Designer project not found.", { id: projectId });
  const image = project.currentVersion?.currentImage;
  if (!image) throw new BusinessRuleError("VALIDATION_ERROR", "Generate a design first before creating its tech pack.");
  return { project, imageAttachmentId: image.imageAttachmentId };
}

async function getMasterTechPack(companyId: string, projectId: string, techPackId: string) {
  const techPack = await AiDesignerTechPackRepository.findByIdScoped(companyId, techPackId);
  if (!techPack || techPack.projectId !== projectId) throw new BusinessRuleError("NOT_FOUND", "Tech pack not found.", { id: techPackId });
  if (!isMasterTechPackJson(techPack.garmentAnalysisJson)) {
    throw new BusinessRuleError("VALIDATION_ERROR", "This is an older table-based tech pack — generate a new tech pack to use page images.");
  }
  return { techPack, json: techPack.garmentAnalysisJson as unknown as MasterTechPackJson };
}

// ---------------------------------------------------------------------------
// Step 1 — master-prompt analysis + 7 page prompts
// ---------------------------------------------------------------------------

/**
 * Runs the master-prompt analysis (one vision call), builds the 7 page
 * prompts and creates the 7 page rows as PENDING. Page images are generated
 * separately (generateTechPackPageImages) so this returns in about a minute
 * while the images render in the background.
 */
export async function startMasterTechPack(actor: ActorContext, projectId: string) {
  const { project, imageAttachmentId } = await getProjectWithImage(actor.companyId, projectId);

  const latest = await AiDesignerTechPackRepository.findLatestByProjectId(projectId);
  if (latest?.status === "IN_PROGRESS" && latest.createdAt >= new Date(Date.now() - PAGE_RUN_STALE_MS)) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "A tech pack is already being generated for this design.", { techPackId: latest.id });
  }

  const techPackRow = await AiDesignerTechPackRepository.create({ companyId: actor.companyId, projectId, status: "IN_PROGRESS", createdByUserId: actor.userId });

  try {
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, imageAttachmentId);
    const fabricDetail = [
      project.fabricComposition && `Composition ${project.fabricComposition}`,
      project.fabricGsm && `GSM ${project.fabricGsm}`,
      project.fabricWidth && `Width ${project.fabricWidth}`,
      project.fabricWeave && `Weave ${project.fabricWeave}`,
      project.fabricStretch && `Stretch ${project.fabricStretch}`,
      project.fabricPatternType && `Pattern ${project.fabricPatternType}`,
      project.fabricColor && `Colour ${project.fabricColor}`,
    ]
      .filter(Boolean)
      .join("; ");
    const selections = (project.designSelectionsJson as Record<string, string> | null) ?? {};
    const analysisBrief = project.sourceAnalysisJson as Record<string, string> | null;
    const designBrief =
      [
        ...Object.entries(selections).map(([k, v]) => `${k}: ${v}`),
        analysisBrief?.keyDetails && `Key details: ${analysisBrief.keyDetails}`,
      ]
        .filter(Boolean)
        .join("; ") || null;

    const { data: analysis } = await analyzeGarmentForTechPack({
      imageBuffer: buffer,
      imageMediaType: toMediaType(attachment.mimeType),
      facts: {
        brandName: project.brandName,
        styleName: project.projectName,
        styleNumber: project.projectNumber,
        garmentCategory: project.productCategory,
        targetCustomer: project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer as TargetCustomer] : null,
        ageGroup: project.ageGroup,
        designer: project.createdBy?.fullName ?? null,
        dateCreated: project.createdAt.toISOString().slice(0, 10),
        fabric: project.fabricProduct?.styleName ?? project.fabricName,
        fabricDetail: fabricDetail || null,
        designBrief,
      },
    });

    const json: MasterTechPackJson = { format: "MASTER_V1", analysis };
    // Every page now gets a real AI-generated image (HYBRID pages 3/5/6 get an
    // illustration-only image; the real table is composited beside/below it by
    // the PDF renderer — see schema.ts's MasterPageMode doc comment).
    const pages = buildTechPackPagePrompts(analysis).map((p) => ({
      ...p,
      imageAttachmentId: null,
      imageStatus: "IN_PROGRESS" as const,
    }));

    const updated = await prisma.aiDesignerTechPack.update({
      where: { id: techPackRow.id },
      data: {
        status: "SUCCESS",
        garmentAnalysisJson: json as unknown as Prisma.InputJsonValue,
        originalGarmentAnalysisJson: json as unknown as Prisma.InputJsonValue,
        designerNotes: analysis.notesForDesigner.join("\n"),
        suggestedAdditionalViews: analysis.suggestedAdditionalViews.join("\n"),
        pages: { create: pages },
      },
      include: { pages: { orderBy: { pageNumber: "asc" } } },
    });

    await writeAuditLog({
      companyId: actor.companyId,
      userId: actor.userId,
      tableName: "ai_tech_packs",
      recordId: techPackRow.id,
      action: "CREATE",
      newValues: { format: "MASTER_V1", bomRows: analysis.bom.length, measurementPoints: analysis.measurements.length },
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await AiDesignerTechPackRepository.markFailed(techPackRow.id, message);
    if (err instanceof AiConfigMissingError || err instanceof AiServiceError || err instanceof AiInvalidResponseError) {
      throw new BusinessRuleError("AI_SERVICE_ERROR", err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Step 2 — page images (background)
// ---------------------------------------------------------------------------

async function generateOnePage(actor: ActorContext, projectId: string, projectNumber: string, pageId: string, prompt: string, reference: { buffer: Buffer; mimeType: string }) {
  try {
    const result = await runWithFailover({
      companyId: actor.companyId,
      userId: actor.userId,
      capability: "IMAGE_EDIT",
      generationContext: `AI Designer / Project ${projectNumber} / Tech Pack page`,
      aiDesignerProjectId: projectId,
      inputImagePresent: true,
      call: (provider) => {
        if (!provider.generateVariation) {
          throw new ImageGenerationServiceError(`The configured image provider ("${provider.name}") cannot generate tech pack pages.`, "UNSUPPORTED_OPERATION");
        }
        return provider.generateVariation({ prompt, count: 1, parentImage: reference, output: { size: "1024x1536", quality: "high" } });
      },
    });
    const image = result.images[0];
    if (!image) throw new Error("The AI provider returned no image.");
    const attachment = await uploadAttachment(
      actor,
      "AI_DESIGNER_PROJECT",
      projectId,
      { buffer: image.buffer, fileName: `tech-pack-page-${Date.now()}.png`, mimeType: image.mimeType },
      "TECH_PACK_PAGE_IMAGE"
    );
    await prisma.aiDesignerTechPackPage.update({ where: { id: pageId }, data: { imageAttachmentId: attachment.id, imageStatus: "SUCCESS", imageError: null } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    await prisma.aiDesignerTechPackPage.update({ where: { id: pageId }, data: { imageStatus: "FAILED", imageError: message.slice(0, 1000) } });
  }
}

/**
 * Generates the page images for the given pages (default: every page not
 * yet generated) with a small concurrency limit. Never throws — each page
 * records its own SUCCESS/FAILED status — so it is safe to run from
 * next/server `after()` once the HTTP response has been sent.
 */
export async function generateTechPackPageImages(actor: ActorContext, projectId: string, techPackId: string, pageNumbers?: number[]) {
  try {
    const { techPack } = await getMasterTechPack(actor.companyId, projectId, techPackId);
    const { project, imageAttachmentId } = await getProjectWithImage(actor.companyId, projectId);
    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, imageAttachmentId);
    const reference = { buffer, mimeType: attachment.mimeType };

    const queue = techPack.pages.filter((p) => (pageNumbers ? pageNumbers.includes(p.pageNumber) : p.imageStatus !== "SUCCESS"));
    const workers = Array.from({ length: Math.min(PAGE_CONCURRENCY, queue.length) }, async () => {
      for (let page = queue.shift(); page; page = queue.shift()) {
        await generateOnePage(actor, projectId, project.projectNumber, page.id, page.promptText ?? "", reference);
      }
    });
    await Promise.all(workers);
  } catch (err) {
    logger.error("Tech pack page image generation failed", { projectId, techPackId, error: err });
    await prisma.aiDesignerTechPackPage
      .updateMany({ where: { techPackId, imageStatus: "IN_PROGRESS" }, data: { imageStatus: "FAILED", imageError: err instanceof Error ? err.message : "Unknown error." } })
      .catch(() => undefined);
  }
}

/** Marks the chosen pages as queued; the caller then runs generateTechPackPageImages (in `after()`). */
export async function queuePageRegeneration(actor: ActorContext, projectId: string, techPackId: string, pageNumbers: number[]) {
  const { techPack } = await getMasterTechPack(actor.companyId, projectId, techPackId);
  const targets = techPack.pages.map((p) => p.pageNumber).filter((n) => pageNumbers.includes(n));
  if (targets.length === 0) throw new BusinessRuleError("VALIDATION_ERROR", "No matching tech pack pages to regenerate.");
  await prisma.aiDesignerTechPackPage.updateMany({
    where: { techPackId, pageNumber: { in: targets } },
    data: { imageStatus: "IN_PROGRESS", imageError: null },
  });
  return { targets, techPack: await AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId) };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Saves the user-edited analysis (the whole A–J object, validated). With
 * `rebuildPrompts`, every page prompt the user has NOT hand-edited is rebuilt
 * from the new data, so fixed fields flow into the next image generation.
 */
export async function updateMasterAnalysis(actor: ActorContext, projectId: string, techPackId: string, input: { analysis: unknown; rebuildPrompts: boolean }) {
  const { techPack } = await getMasterTechPack(actor.companyId, projectId, techPackId);
  const parsed = masterAnalysisSchema.safeParse(input.analysis);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BusinessRuleError("VALIDATION_ERROR", `Invalid tech pack data: ${first ? `${first.path.join(".")} — ${first.message}` : "unknown"}.`);
  }
  const analysis: MasterAnalysis = parsed.data;
  const json: MasterTechPackJson = { format: "MASTER_V1", analysis };

  await prisma.$transaction(async (tx) => {
    await tx.aiDesignerTechPack.update({
      where: { id: techPackId },
      data: {
        garmentAnalysisJson: json as unknown as Prisma.InputJsonValue,
        designerNotes: analysis.notesForDesigner.join("\n"),
        suggestedAdditionalViews: analysis.suggestedAdditionalViews.join("\n"),
      },
    });
    if (input.rebuildPrompts) {
      for (const p of buildTechPackPagePrompts(analysis)) {
        const existing = techPack.pages.find((x) => x.pageNumber === p.pageNumber);
        if (existing && !existing.promptEdited) {
          await tx.aiDesignerTechPackPage.update({ where: { id: existing.id }, data: { promptText: p.promptText } });
        }
      }
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_packs",
    recordId: techPackId,
    action: "UPDATE",
    newValues: { analysisEdited: true, rebuildPrompts: input.rebuildPrompts },
  });
  return AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
}

/** Saves a hand-edited page prompt (or, with `reset`, rebuilds it from the analysis again). */
export async function updatePagePrompt(actor: ActorContext, projectId: string, techPackId: string, input: { pageNumber: number; promptText?: string; reset?: boolean }) {
  const { techPack, json } = await getMasterTechPack(actor.companyId, projectId, techPackId);
  const page = techPack.pages.find((p) => p.pageNumber === input.pageNumber);
  if (!page) throw new BusinessRuleError("NOT_FOUND", "Tech pack page not found.", { pageNumber: input.pageNumber });

  const promptText = input.reset
    ? buildTechPackPagePrompts(json.analysis).find((p) => p.pageNumber === input.pageNumber)!.promptText
    : (input.promptText ?? "").trim();
  if (!promptText) throw new BusinessRuleError("VALIDATION_ERROR", "The page prompt cannot be empty.");

  await prisma.aiDesignerTechPackPage.update({ where: { id: page.id }, data: { promptText, promptEdited: !input.reset } });
  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "ai_tech_pack_pages",
    recordId: page.id,
    action: "UPDATE",
    newValues: { pageNumber: input.pageNumber, promptEdited: !input.reset },
  });
  return AiDesignerTechPackRepository.findByIdScoped(actor.companyId, techPackId);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

export async function exportMasterTechPackPdf(actor: ActorContext, projectId: string, techPackId: string) {
  const { techPack, json } = await getMasterTechPack(actor.companyId, projectId, techPackId);
  const project = await AiDesignerProjectRepository.findAnyById(actor.companyId, projectId);
  const loadImage = (attachmentId: string | null | undefined) =>
    attachmentId
      ? getAttachmentForDownload(actor.companyId, attachmentId).then(
          (r) => ({ buffer: r.buffer, mimeType: r.attachment.mimeType }),
          () => null
        )
      : Promise.resolve(null);

  const pages = await Promise.all(
    techPack.pages.map(async (p) => ({ pageNumber: p.pageNumber, pageTitle: p.pageTitle, mode: pageMode(p.pageNumber), image: await loadImage(p.imageAttachmentId) }))
  );

  const { renderTechPackImagesPdf } = await import("@/core/ai-designer/export/tech-pack-images-pdf");
  const styleNumber = project?.projectNumber ?? "tech-pack";
  const buffer = await renderTechPackImagesPdf({
    title: `Tech Pack ${styleNumber}`,
    analysis: json.analysis,
    pages,
  });
  return { buffer, mimeType: "application/pdf", fileName: `tech-pack-${styleNumber}.pdf` };
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { AiGarmentProjectRepository } from "@/modules/ai-garment-flow/ai-garment-project.repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const attachments = await listAttachments(session.user.companyId, "AI_GARMENT_PROJECT", id);

    return NextResponse.json({ data: attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    const assetType = formData.get("assetType");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    // Snapshot the project's current status server-side (never trust a
    // client-supplied label) — same discipline as Sampling's own upload
    // route. contextLabel is reused here as an asset-type tag ("REFERENCE_
    // IMAGE"/"FABRIC_SWATCH"/"GENERATED_DESIGN"/etc, chosen by the caller)
    // rather than a workflow-stage snapshot, since that's the more useful
    // axis for this module's own file list — see the schema comment on
    // RelatedModule.AI_GARMENT_PROJECT.
    const project = await AiGarmentProjectRepository.findAnyById(session.user.companyId, id);
    if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "AI_GARMENT_PROJECT",
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      typeof assetType === "string" && assetType ? assetType : "DOCUMENT"
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

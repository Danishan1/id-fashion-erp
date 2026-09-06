import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getAttachmentMetadata } from "@/core/attachments/AttachmentService";
import { AiGarmentProjectRepository } from "@/modules/ai-garment-flow/ai-garment-project.repository";
import { setReferenceImage, deleteReferenceImage } from "@/modules/ai-garment-flow/reference-analysis.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const project = await AiGarmentProjectRepository.findAnyById(session.user.companyId, id);
    if (!project) throw new BusinessRuleError("NOT_FOUND", "AI Garment Flow project not found.", { id });

    if (!project.referenceImageAttachmentId) {
      return NextResponse.json({ data: null });
    }
    const attachment = await getAttachmentMetadata(session.user.companyId, project.referenceImageAttachmentId);
    return NextResponse.json({ data: attachment });
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
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await setReferenceImage(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    await deleteReferenceImage({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}

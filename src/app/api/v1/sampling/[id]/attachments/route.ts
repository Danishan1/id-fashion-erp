import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { listAttachments, uploadAttachment } from "@/core/attachments/AttachmentService";
import { SampleRequestRepository } from "@/modules/sampling/sample.repository";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");

    const { id } = await params;
    const attachments = await listAttachments(session.user.companyId, "SAMPLE_REQUEST", id);

    return NextResponse.json({ data: attachments });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    // Snapshot the sample's current stage server-side (never trust a
    // client-supplied stage label) so the attachment list can later show
    // "uploaded during: In Development" even after the sample moves on.
    const sampleRequest = await SampleRequestRepository.findAnyById(session.user.companyId, id);
    if (!sampleRequest) throw new BusinessRuleError("NOT_FOUND", "Sample request not found.", { id });

    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await uploadAttachment(
      { companyId: session.user.companyId, userId: session.user.id },
      "SAMPLE_REQUEST",
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      sampleRequest.status
    );

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

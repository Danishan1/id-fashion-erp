import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteAttachment } from "@/core/attachments/AttachmentService";
import { SampleRequestRepository } from "@/modules/sampling/sample.repository";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { attachmentId } = await params;
    // If this attachment is currently a request's designated main image,
    // clear the pointer first so it never dangles once it's gone.
    await SampleRequestRepository.clearMainImageIfMatches(session.user.companyId, attachmentId);
    await deleteAttachment({ companyId: session.user.companyId, userId: session.user.id }, attachmentId);

    return NextResponse.json({ data: { id: attachmentId } });
  } catch (error) {
    return handleApiError(error);
  }
}

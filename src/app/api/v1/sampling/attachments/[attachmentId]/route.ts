import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteAttachment } from "@/core/attachments/AttachmentService";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "edit");

    const { attachmentId } = await params;
    await deleteAttachment({ companyId: session.user.companyId, userId: session.user.id }, attachmentId);

    return NextResponse.json({ data: { id: attachmentId } });
  } catch (error) {
    return handleApiError(error);
  }
}

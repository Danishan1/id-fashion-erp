import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteAttachment, getAttachmentMetadata } from "@/core/attachments/AttachmentService";

export async function DELETE(_req: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");
    const { attachmentId } = await params;
    // crm.edit must only ever reach a LEAD's files — never another module's
    // attachment reached by id through this route.
    const meta = await getAttachmentMetadata(session.user.companyId, attachmentId);
    if (meta.relatedModule !== "LEAD") throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
    await deleteAttachment({ companyId: session.user.companyId, userId: session.user.id }, attachmentId);
    return NextResponse.json({ data: { id: attachmentId } });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAttachmentForDownload } from "@/core/attachments/AttachmentService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

export async function GET(req: NextRequest, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const { attachmentId } = await params;
    const { attachment, buffer } = await getAttachmentForDownload(session.user.companyId, attachmentId);
    // crm.view must only ever reach a LEAD's files, not another module's.
    if (attachment.relatedModule !== "LEAD") throw new BusinessRuleError("NOT_FOUND", "Attachment not found.", { id: attachmentId });
    // ?disposition=inline lets the preview modal render images/PDFs in place.
    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
        "Content-Length": String(attachment.fileSizeBytes),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

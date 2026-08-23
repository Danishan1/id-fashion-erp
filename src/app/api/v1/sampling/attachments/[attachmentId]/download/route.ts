import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAttachmentForDownload } from "@/core/attachments/AttachmentService";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");

    const { attachmentId } = await params;
    const { attachment, buffer } = await getAttachmentForDownload(session.user.companyId, attachmentId);

    // ?disposition=inline lets the file-preview modal render images/PDFs
    // straight in the browser instead of forcing a save-as prompt — the
    // plain download link (no query param) keeps forcing a download as before.
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

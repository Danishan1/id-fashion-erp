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
    await PermissionService.assert(session.user.id, "expenses", "view");

    const { attachmentId } = await params;
    const { attachment, buffer } = await getAttachmentForDownload(session.user.companyId, attachmentId);

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

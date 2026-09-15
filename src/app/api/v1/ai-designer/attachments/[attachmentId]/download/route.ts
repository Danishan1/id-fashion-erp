import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getAttachmentForDownload } from "@/core/attachments/AttachmentService";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

/** Shared, generic download for any AI Designer attachment (fabric image, generated image) — same pattern as every other module's attachment download route. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

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

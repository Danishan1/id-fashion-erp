import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import {
  deleteAttachment,
  getAttachmentForDownload,
  getAttachmentMetadata,
} from "@/core/attachments/AttachmentService";
import { assertAttachmentAccess } from "@/core/attachments/attachment-targets";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

/** Download (or `?disposition=inline` to view/play) one attachment. */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { attachmentId } = await params;
    const actor = { companyId: session.user.companyId, userId: session.user.id };

    const meta = await getAttachmentMetadata(actor.companyId, attachmentId);
    await assertAttachmentAccess(actor, meta.relatedModule, meta.relatedRecordId, "view");

    const { attachment, buffer } = await getAttachmentForDownload(actor.companyId, attachmentId);
    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `${disposition}; filename="${encodeURIComponent(attachment.fileName)}"`,
        "Content-Length": String(attachment.fileSizeBytes),
        "Accept-Ranges": "none",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { attachmentId } = await params;
    const actor = { companyId: session.user.companyId, userId: session.user.id };

    const meta = await getAttachmentMetadata(actor.companyId, attachmentId);
    await assertAttachmentAccess(actor, meta.relatedModule, meta.relatedRecordId, "create");
    await deleteAttachment(actor, attachmentId);

    return NextResponse.json({ data: { id: attachmentId } });
  } catch (error) {
    return handleApiError(error);
  }
}

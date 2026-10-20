import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteJobOrderSlip, getJobOrderSlipForDownload } from "@/modules/production/work-portal.service";

type Params = { params: Promise<{ id: string; attachmentId: string }> };

/** P4: download (or view inline with ?disposition=inline) a job order slip. */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id, attachmentId } = await params;
    const { attachment, buffer } = await getJobOrderSlipForDownload(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      attachmentId
    );
    const inline = req.nextUrl.searchParams.get("disposition") === "inline";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(attachment.fileName)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id, attachmentId } = await params;
    await deleteJobOrderSlip({ companyId: session.user.companyId, userId: session.user.id }, id, attachmentId);
    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { exportTechPackPdf, getLatestTechPack } from "@/modules/ai-designer/ai-designer.service";
import { exportMasterTechPackPdf } from "@/modules/ai-designer/tech-pack-master.service";
import { isMasterTechPackJson } from "@/core/ai-designer/tech-pack-master/schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Downloads the latest Tech Pack as one PDF. A master-prompt tech pack is
 * the 7 AI page images, one per page; an older table-based tech pack keeps
 * its original typeset PDF.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "export");

    const { id } = await params;
    const actor = { companyId: session.user.companyId, userId: session.user.id };
    const latest = await getLatestTechPack(session.user.companyId, id);
    const { buffer, mimeType, fileName } =
      latest && isMasterTechPackJson(latest.garmentAnalysisJson)
        ? await exportMasterTechPackPdf(actor, id, latest.id)
        : await exportTechPackPdf(actor, id);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

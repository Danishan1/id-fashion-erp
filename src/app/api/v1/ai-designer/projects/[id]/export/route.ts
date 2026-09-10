import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { EXPORT_FORMATS, type ExportFormat } from "@/modules/ai-designer/ai-designer.schema";
import { exportProject } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Step 12 — Export (PNG/JPG/PDF now; DXF/Tech Pack are the brief's own "Future Support" items). */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "export");

    const { id } = await params;
    const format = req.nextUrl.searchParams.get("format") as ExportFormat | null;
    if (!format || !EXPORT_FORMATS.includes(format)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `?format must be one of: ${EXPORT_FORMATS.join(", ")}.`);
    }

    const { buffer, mimeType, fileName } = await exportProject({ companyId: session.user.companyId, userId: session.user.id }, id, format);

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

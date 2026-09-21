import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteSketchImage, uploadSketchImage } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** SKETCH mode, Step 1 — "upload a new sketch/drawing image" branch. Mirrors fabric-image/route.ts exactly. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadSketchImage(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const project = await deleteSketchImage({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadCustomTemplate } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const data = await uploadCustomTemplate({ companyId: session.user.companyId, userId: session.user.id }, id, {
      buffer,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

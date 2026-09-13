import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { REFERENCE_IMAGE_SLOTS, type ReferenceImageSlot } from "@/modules/ai-designer/replicate-design.schema";
import { uploadReferenceImage } from "@/modules/ai-designer/replicate-design.service";

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
    const slot = formData.get("slot");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }
    if (typeof slot !== "string" || !REFERENCE_IMAGE_SLOTS.includes(slot as ReferenceImageSlot)) {
      throw new BusinessRuleError("VALIDATION_ERROR", `"slot" must be one of: ${REFERENCE_IMAGE_SLOTS.join(", ")}.`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadReferenceImage(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      slot as ReferenceImageSlot,
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

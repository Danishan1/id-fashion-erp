import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { maskEditInstructionSchema } from "@/core/ai/image-generation/mask-edit";
import { generateMaskEditPreview } from "@/modules/ai-designer/ai-designer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * "Draw & Describe" — generates 1-4 preview candidates for a change confined
 * to a pencil-drawn mask area. Multipart, not JSON, since the mask travels
 * as a real PNG file alongside the instruction text. Never overwrites the
 * current design by itself — the resulting images land in the same PENDING
 * review queue as every other edit mode; see images/[imageId]/apply-edit
 * for the explicit apply step (shared with QUICK/TECHNICAL/AI_PROMPT edits).
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const { id } = await params;
    const formData = await req.formData();

    const mask = formData.get("mask");
    if (!(mask instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No drawn mask was submitted.");
    }
    if (mask.type && mask.type !== "image/png") {
      throw new BusinessRuleError("VALIDATION_ERROR", "The drawn mask must be a PNG image.");
    }

    const input = maskEditInstructionSchema.parse({
      instruction: formData.get("instruction"),
      imageCount: formData.get("imageCount") ?? undefined,
    });

    const maskBuffer = Buffer.from(await mask.arrayBuffer());
    const result = await generateMaskEditPreview(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { instruction: input.instruction, imageCount: input.imageCount, maskBuffer }
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

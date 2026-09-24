import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { maskEditInstructionSchema } from "@/core/ai/image-generation/mask-edit";
import { generateReplicateMaskEditPreview } from "@/modules/ai-designer/replicate-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * "Draw & Describe" — Replicate Design's own mirror of AI Designer's
 * projects/[id]/mask-edit route (same multipart contract, same
 * maskEditInstructionSchema, same underlying runMaskEditGeneration
 * pipeline) — only the persistence target differs (this module's own
 * separate Prompt/Generation/Image tables via generateReplicateMaskEditPreview).
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
    const result = await generateReplicateMaskEditPreview(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { instruction: input.instruction, imageCount: input.imageCount, maskBuffer }
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

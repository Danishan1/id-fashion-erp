import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { deleteOptionReferenceImageSchema } from "@/modules/ai-designer/ai-designer-attribute-master.schema";
import {
  deleteOptionReferenceImage,
  listAllKnownOptionValues,
  listOptionReferenceImages,
  uploadOptionReferenceImage,
} from "@/modules/ai-designer/ai-designer-attribute-master.service";
import { listSketchStructureOptions } from "@/core/ai-designer/catalogs/sketch-structure-catalog";
import type { OptionImageVariant } from "@/modules/ai-designer/ai-designer.repository";

/** `variant=CAD_FLAT` selects the construction-option sketches; anything else is the Product Design photo set. */
function readVariant(raw: string | null | undefined): OptionImageVariant {
  return raw === "CAD_FLAT" ? "CAD_FLAT" : "PHOTO";
}

/**
 * Masters -> AI Design. PHOTO (default): Product Design reference photos per
 * option VALUE (e.g. "Deep Back Cut-Out"). CAD_FLAT: the small line-drawing
 * photo for each edit-page construction option (A-Line, V-Neck, ...).
 * GET returns every known option value for that set, alongside whichever ones
 * already have an image (attachmentId null otherwise).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");
    const variant = readVariant(req.nextUrl.searchParams.get("variant"));

    const [knownValues, overrides] = await Promise.all([
      variant === "CAD_FLAT"
        ? Promise.resolve(listSketchStructureOptions().map((o) => o.value))
        : listAllKnownOptionValues(session.user.companyId),
      listOptionReferenceImages(session.user.companyId, variant),
    ]);

    const data = knownValues.map((optionValue) => ({
      optionValue,
      attachmentId: overrides[optionValue] ?? null,
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const formData = await req.formData();
    const optionValue = formData.get("optionValue");
    const file = formData.get("file");
    const variant = readVariant(typeof formData.get("variant") === "string" ? (formData.get("variant") as string) : null);
    if (typeof optionValue !== "string" || !optionValue.trim()) {
      throw new BusinessRuleError("VALIDATION_ERROR", "optionValue is required.");
    }
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No file was uploaded.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const row = await uploadOptionReferenceImage(
      { companyId: session.user.companyId, userId: session.user.id },
      optionValue.trim(),
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" },
      variant
    );

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");

    const input = deleteOptionReferenceImageSchema.parse(await req.json());
    await deleteOptionReferenceImage(
      { companyId: session.user.companyId, userId: session.user.id },
      input.optionValue,
      readVariant(input.variant)
    );

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}

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

/**
 * Masters -> AI Design -> Product Design -> Reference Photos. Lets an admin
 * upload/replace a real photo per option VALUE (e.g. "Deep Back Cut-Out"),
 * superseding the AI-generated static photo without needing an
 * image-generation provider at all. GET returns every known option value
 * this company could need a photo for, alongside whichever ones already
 * have an uploaded override (attachmentId null otherwise).
 */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "view");

    const [knownValues, overrides] = await Promise.all([
      listAllKnownOptionValues(session.user.companyId),
      listOptionReferenceImages(session.user.companyId),
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
      { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" }
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
    await deleteOptionReferenceImage({ companyId: session.user.companyId, userId: session.user.id }, input.optionValue);

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleApiError(error);
  }
}

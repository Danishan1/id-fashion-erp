import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { sketchEditSchema } from "@/modules/ai-designer/new-design.schema";
import { executeSketchEdit } from "@/modules/ai-designer/new-design.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_MARKUP_BYTES = 15 * 1024 * 1024;

/**
 * Through-Sketch edit. Plain JSON for option/text edits; multipart for
 * "Draw with Pen" — a `markup` PNG (sketch + pen strokes) plus the same
 * fields as a JSON string in `payload`.
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_designer", "edit");
    const { id } = await params;

    let rawInput: unknown;
    let markupImage: { buffer: Buffer; mimeType: string } | null = null;

    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const formData = await req.formData();
      const payload = formData.get("payload");
      try {
        rawInput = typeof payload === "string" && payload ? JSON.parse(payload) : {};
      } catch {
        throw new BusinessRuleError("VALIDATION_ERROR", "Sketch edit details could not be read.");
      }
      const markup = formData.get("markup");
      if (!(markup instanceof File)) {
        throw new BusinessRuleError("VALIDATION_ERROR", "No pen markup was submitted — draw on the sketch first.");
      }
      if (markup.type && markup.type !== "image/png") {
        throw new BusinessRuleError("VALIDATION_ERROR", "The pen markup must be a PNG image.");
      }
      if (markup.size > MAX_MARKUP_BYTES) {
        throw new BusinessRuleError("VALIDATION_ERROR", "The marked-up sketch is too large (max 15 MB).");
      }
      markupImage = { buffer: Buffer.from(await markup.arrayBuffer()), mimeType: "image/png" };
    } else {
      rawInput = await req.json();
    }

    const input = sketchEditSchema.parse(rawInput);
    const data = await executeSketchEdit(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input,
      { markupImage }
    );
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

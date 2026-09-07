import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createFabricApplicationSchema } from "@/modules/ai-garment-flow/fabric-application.schema";
import { createFabricApplication, listFabricApplications } from "@/modules/ai-garment-flow/fabric-application.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const TEXT_FIELDS = [
  "fabricCode",
  "composition",
  "width",
  "gsm",
  "wovenOrKnit",
  "stretch",
  "drape",
  "transparency",
  "surfaceCharacter",
  "printPattern",
  "directionality",
  "specialPlacement",
] as const;

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const applications = await listFabricApplications(session.user.companyId, id);

    return NextResponse.json({ data: applications });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No fabric swatch file was uploaded.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    // FormData values are always strings — an unanswered "Unknown" field
    // must become `undefined` (not an empty string) before Zod parses it, so
    // its own `.optional()` actually treats it as unset rather than "".
    const raw: Record<string, string | undefined> = {};
    for (const key of TEXT_FIELDS) {
      const v = formData.get(key);
      raw[key] = typeof v === "string" && v.trim() !== "" ? v : undefined;
    }
    const availableQuantityRaw = formData.get("availableQuantity");
    const costPerMetreRaw = formData.get("costPerMetre");

    const input = createFabricApplicationSchema.parse({
      ...raw,
      availableQuantity: typeof availableQuantityRaw === "string" && availableQuantityRaw.trim() !== "" ? availableQuantityRaw : undefined,
      costPerMetre: typeof costPerMetreRaw === "string" && costPerMetreRaw.trim() !== "" ? costPerMetreRaw : undefined,
    });

    const application = await createFabricApplication(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { ...input, swatchFile: { buffer, fileName: file.name, mimeType: file.type || "application/octet-stream" } }
    );

    return NextResponse.json({ data: application }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createTechnicalFlatSchema } from "@/modules/ai-garment-flow/technical-development.schema";
import { createTechnicalFlat, listTechnicalFlats } from "@/modules/ai-garment-flow/technical-development.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const flats = await listTechnicalFlats(session.user.companyId, id);

    return NextResponse.json({ data: flats });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = createTechnicalFlatSchema.parse(await req.json());
    const flat = await createTechnicalFlat({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: flat }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

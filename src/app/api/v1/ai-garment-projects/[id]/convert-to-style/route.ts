import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { convertProjectToStyleSchema } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { convertProjectToStyle } from "@/modules/ai-garment-flow/ai-garment-project.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Matches convertSampleToStyle()'s own precedent — gated on "edit", not a
    // separate "convert" action.
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = convertProjectToStyleSchema.parse(await req.json());
    const result = await convertProjectToStyle(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

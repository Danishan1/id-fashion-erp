import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveTechnicalFlatSchema } from "@/modules/ai-garment-flow/technical-development.schema";
import { approveTechnicalFlat } from "@/modules/ai-garment-flow/technical-development.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = approveTechnicalFlatSchema.parse(await req.json());
    const project = await approveTechnicalFlat({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: project });
  } catch (error) {
    return handleApiError(error);
  }
}

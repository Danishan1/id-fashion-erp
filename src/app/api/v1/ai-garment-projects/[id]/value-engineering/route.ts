import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateValueEngineeringSchema } from "@/modules/ai-garment-flow/value-engineering.schema";
import { generateValueEngineering, getLatestValueEngineering } from "@/modules/ai-garment-flow/value-engineering.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "view");

    const { id } = await params;
    const analysis = await getLatestValueEngineering(session.user.companyId, id);

    return NextResponse.json({ data: analysis });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "ai_garment_flow", "edit");

    const { id } = await params;
    const input = generateValueEngineeringSchema.parse(await req.json());
    const analysis = await generateValueEngineering({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: analysis }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

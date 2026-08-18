import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricCompositionSchema } from "@/modules/fabric-config/fabric-config.schema";
import { listFabricCompositions, createFabricComposition } from "@/modules/fabric-config/fabric-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listFabricCompositions(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = fabricCompositionSchema.parse(await req.json());
    const composition = await createFabricComposition({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: composition }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

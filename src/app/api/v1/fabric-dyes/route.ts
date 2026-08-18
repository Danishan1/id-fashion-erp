import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricDyeSchema } from "@/modules/fabric-config/fabric-config.schema";
import { listFabricDyes, createFabricDye } from "@/modules/fabric-config/fabric-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listFabricDyes(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = fabricDyeSchema.parse(await req.json());
    const dye = await createFabricDye({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: dye }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

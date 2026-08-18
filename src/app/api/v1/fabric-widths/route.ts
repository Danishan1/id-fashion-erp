import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { fabricWidthSchema } from "@/modules/fabric-config/fabric-config.schema";
import { listFabricWidths, createFabricWidth } from "@/modules/fabric-config/fabric-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listFabricWidths(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = fabricWidthSchema.parse(await req.json());
    const width = await createFabricWidth({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: width }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

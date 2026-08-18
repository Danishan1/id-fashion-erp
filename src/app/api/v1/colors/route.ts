import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { colorSchema } from "@/modules/lookups/lookup.schema";
import { listColors, createColor } from "@/modules/lookups/lookup.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listColors(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = colorSchema.parse(await req.json());
    const color = await createColor({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: color }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

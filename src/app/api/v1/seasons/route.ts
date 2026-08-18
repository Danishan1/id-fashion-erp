import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { seasonSchema } from "@/modules/garment-attributes/garment-attributes.schema";
import { listSeasons, createSeason } from "@/modules/garment-attributes/garment-attributes.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listSeasons(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = seasonSchema.parse(await req.json());
    const season = await createSeason({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: season }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

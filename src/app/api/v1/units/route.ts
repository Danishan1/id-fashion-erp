import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { unitSchema } from "@/modules/lookups/lookup.schema";
import { listUnits, createUnit } from "@/modules/lookups/lookup.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");
    return NextResponse.json({ data: await listUnits() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = unitSchema.parse(await req.json());
    const unit = await createUnit({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: unit }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

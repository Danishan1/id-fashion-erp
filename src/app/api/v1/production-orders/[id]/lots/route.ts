import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createLotSchema } from "@/modules/production/production.schema";
import { createLot } from "@/modules/production/lot.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { id } = await params;
    const input = createLotSchema.parse(await req.json());
    const lot = await createLot(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: lot }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

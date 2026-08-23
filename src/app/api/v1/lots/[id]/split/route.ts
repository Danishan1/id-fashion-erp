import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { splitLotSchema } from "@/modules/production/production.schema";
import { splitLot } from "@/modules/production/lot.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Gated on "production.approve" — Lot restructure (split/merge) is a
// deliberately higher-authority action than routine forward/revert
// movement, reusing the existing action rather than inventing a new verb.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const { id } = await params;
    const input = splitLotSchema.parse(await req.json());
    const children = await splitLot(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: children }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

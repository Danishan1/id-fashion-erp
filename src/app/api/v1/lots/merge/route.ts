import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { mergeLotsSchema } from "@/modules/production/production.schema";
import { mergeLots } from "@/modules/production/lot.service";

// Same "production.approve" reasoning as split — see that route.
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const input = mergeLotsSchema.parse(await req.json());
    const child = await mergeLots(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: child }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setBranchActiveStatus } from "@/modules/administration/branch.service";
import { branchStatusSchema } from "@/modules/administration/branch.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "edit");

    const { id } = await params;
    const { isActive } = branchStatusSchema.parse(await req.json());
    const branch = await setBranchActiveStatus({ companyId: session.user.companyId, userId: session.user.id }, id, isActive);
    return NextResponse.json({ data: branch });
  } catch (error) {
    return handleApiError(error);
  }
}

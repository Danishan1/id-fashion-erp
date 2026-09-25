import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateBranch } from "@/modules/administration/branch.service";
import { branchSchema } from "@/modules/administration/branch.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "edit");

    const { id } = await params;
    const input = branchSchema.parse(await req.json());
    const branch = await updateBranch({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: branch });
  } catch (error) {
    return handleApiError(error);
  }
}

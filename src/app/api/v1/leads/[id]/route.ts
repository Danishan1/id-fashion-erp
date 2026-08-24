import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateLeadSchema } from "@/modules/crm/lead.schema";
import { getLeadById, updateLead } from "@/modules/crm/lead.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const { id } = await params;
    const lead = await getLeadById(session.user.companyId, id);

    return NextResponse.json({ data: lead });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = updateLeadSchema.parse(await req.json());
    const lead = await updateLead(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: lead });
  } catch (error) {
    return handleApiError(error);
  }
}

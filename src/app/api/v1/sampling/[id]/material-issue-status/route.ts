import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleMaterialIssueStatus } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Planned vs issued material for the sample's current version — feeds the "Start Development" gate in the UI. */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");
    const { id } = await params;
    const data = await getSampleMaterialIssueStatus(session.user.companyId, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

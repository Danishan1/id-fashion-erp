import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");

    const { id } = await params;
    const request = await getSampleRequestById(session.user.companyId, id);

    return NextResponse.json({ data: request });
  } catch (error) {
    return handleApiError(error);
  }
}

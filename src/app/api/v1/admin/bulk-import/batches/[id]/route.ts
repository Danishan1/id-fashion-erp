import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getImportBatchById } from "@/modules/import/import.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const { id } = await params;
    const batch = await getImportBatchById(session.user.companyId, id);

    return NextResponse.json({ data: batch });
  } catch (error) {
    return handleApiError(error);
  }
}

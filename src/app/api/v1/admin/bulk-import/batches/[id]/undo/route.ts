import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { undoBulkImportBatch } from "@/modules/import/bulk-import.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const { id } = await params;
    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };
    const result = await undoBulkImportBatch(actor, id);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}

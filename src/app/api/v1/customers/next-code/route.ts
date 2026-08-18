import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { previewNextMasterCode } from "@/core/numbering/DocumentNumberingService";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");
    const code = await previewNextMasterCode(session.user.companyId, "CUSTOMER");
    return NextResponse.json({ data: { code } });
  } catch (error) {
    return handleApiError(error);
  }
}

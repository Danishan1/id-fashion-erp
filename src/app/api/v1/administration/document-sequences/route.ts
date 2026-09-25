import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { listDocumentSequences } from "@/modules/administration/document-sequence.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "view");

    const sequences = await listDocumentSequences(session.user.companyId);
    return NextResponse.json({ data: sequences });
  } catch (error) {
    return handleApiError(error);
  }
}

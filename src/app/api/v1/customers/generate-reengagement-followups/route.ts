import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { generateReengagementFollowups } from "@/modules/customers/customer-segments.service";

export async function POST() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "marketing", "edit");

    const result = await generateReengagementFollowups(session.user.companyId, session.user.id);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}

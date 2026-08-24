import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateCrmSettingsSchema } from "@/modules/crm/crm-settings.schema";
import { getCrmSettings, updateCrmSettings } from "@/modules/crm/crm-settings.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const settings = await getCrmSettings(session.user.companyId);

    return NextResponse.json({ data: settings });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const input = updateCrmSettingsSchema.parse(await req.json());
    const settings = await updateCrmSettings({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: settings });
  } catch (error) {
    return handleApiError(error);
  }
}

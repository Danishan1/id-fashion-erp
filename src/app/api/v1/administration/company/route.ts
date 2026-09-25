import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCompanySettings, updateCompanySettings } from "@/modules/administration/company-settings.service";
import { companySettingsSchema } from "@/modules/administration/company-settings.schema";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "view");

    const company = await getCompanySettings(session.user.companyId);
    return NextResponse.json({ data: company });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "edit");

    const input = companySettingsSchema.parse(await req.json());
    const company = await updateCompanySettings({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: company });
  } catch (error) {
    return handleApiError(error);
  }
}

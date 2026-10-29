import { NextResponse } from "next/server";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handleApiError, requireSession } from "@/lib/api-route";
import { getSalesMarketingSettings, updateSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";

/** GET / PUT Sales & Marketing settings (quotation approval limits, defaults). Module `sales_marketing_settings`. */
export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_marketing_settings", "view");
    return NextResponse.json({ data: await getSalesMarketingSettings(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sales_marketing_settings", "edit");
    return NextResponse.json({ data: await updateSalesMarketingSettings({ companyId: session.user.companyId, userId: session.user.id }, await req.json()) });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getDispatchSettings, setDispatchSettings } from "@/core/dispatch-settings/DispatchSettingsService";

const updateDispatchSettingsSchema = z.object({
  allowExtraDispatch: z.boolean().optional(),
  extraDispatchApprovalRequired: z.boolean().optional(),
  extraDispatchApprovalThresholdQty: z.number().int().nonnegative().nullable().optional(),
  extraDispatchApprovalThresholdPercent: z.number().min(0).max(100).nullable().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");
    const data = await getDispatchSettings(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "edit");

    const input = updateDispatchSettingsSchema.parse(await req.json());
    const data = await setDispatchSettings(session.user.companyId, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

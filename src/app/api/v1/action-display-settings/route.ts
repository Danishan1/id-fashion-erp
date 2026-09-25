import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getActionDisplaySettings, setActionDisplaySettings } from "@/core/action-display/ActionDisplayService";

const updateActionDisplaySettingsSchema = z.object({
  displayMode: z.enum(["ICON", "TEXT"]).optional(),
  textStyle: z.enum(["LINK", "BUTTON"]).optional(),
});

// Cross-cutting, no-module-gated read -- same pattern as
// /api/v1/submodule-visibility and /api/v1/ai-designer/settings. Every
// authenticated user's row actions app-wide are driven by this, regardless
// of their "administration_settings" grant.
export async function GET() {
  try {
    const session = await requireSession();
    const data = await getActionDisplaySettings(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    // Gated on "create", not "edit" -- matches admin/page.tsx's own
    // canManage computation (also "create"), so the UI's enabled/disabled
    // toggle state and this route's real permission check can never
    // silently drift apart.
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const input = updateActionDisplaySettingsSchema.parse(await req.json());
    const data = await setActionDisplaySettings(session.user.companyId, input);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

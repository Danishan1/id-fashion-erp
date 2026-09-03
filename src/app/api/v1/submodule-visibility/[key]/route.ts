import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { setSubmoduleVisibility } from "@/core/submodule-visibility/SubmoduleVisibilityService";

const bodySchema = z.object({ isVisible: z.boolean() });

// Gated on "create", not "edit" -- matches admin/page.tsx's own `canManage`
// computation (also "create"), so the UI's enabled/disabled toggle state
// and this route's real permission check can never silently drift apart.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "create");

    const { key } = await params;
    const { isVisible } = bodySchema.parse(await req.json());
    const map = await setSubmoduleVisibility(session.user.companyId, key, isVisible);
    return NextResponse.json({ data: map });
  } catch (error) {
    return handleApiError(error);
  }
}

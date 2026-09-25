import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateDisplayModeSchema } from "@/modules/ai-designer/ai-designer.schema";
import { getProductDesignDisplayMode, setProductDesignDisplayMode } from "@/modules/ai-designer/ai-designer-settings.service";

// Cross-cutting, no-module-gated read -- same pattern as
// /api/v1/submodule-visibility. Every AI Designer user filling the Product
// Design step needs this to know which style to render, regardless of
// their "administration_settings" grant.
export async function GET() {
  try {
    const session = await requireSession();
    const productDesignDisplayMode = await getProductDesignDisplayMode(session.user.companyId);
    return NextResponse.json({ data: { productDesignDisplayMode } });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration_settings", "create");

    const input = updateDisplayModeSchema.parse(await req.json());
    const productDesignDisplayMode = await setProductDesignDisplayMode(session.user.companyId, input.productDesignDisplayMode);

    return NextResponse.json({ data: { productDesignDisplayMode } });
  } catch (error) {
    return handleApiError(error);
  }
}

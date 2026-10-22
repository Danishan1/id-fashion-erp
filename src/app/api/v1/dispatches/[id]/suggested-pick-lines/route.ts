import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSuggestedPickLines } from "@/modules/dispatch/dispatch.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Pick lines auto-filled from the Sales Order and the Finished Goods in stock — read-only, the user reviews and saves. */
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");
    const { id } = await params;
    const data = await getSuggestedPickLines({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

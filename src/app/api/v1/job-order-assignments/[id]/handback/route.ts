import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { handBackAssignment, handbackSchema } from "@/modules/production/work-portal.service";

/** P4: hand back unworked pieces of an assignment (the worker, or a supervisor in scope). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");
    const { id } = await params;
    const input = handbackSchema.parse(await req.json());
    const data = await handBackAssignment({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data }, { status: 201, headers: { "x-toast-success": "Pieces handed back." } });
  } catch (error) {
    return handleApiError(error);
  }
}

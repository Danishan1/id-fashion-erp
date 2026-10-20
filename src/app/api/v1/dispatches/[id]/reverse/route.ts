import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { reverseDispatch } from "@/modules/dispatch/dispatch.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "cancel");

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = body?.reason || "Dispatch reversed by user";

    const dispatch = await reverseDispatch(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      { reason }
    );

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}

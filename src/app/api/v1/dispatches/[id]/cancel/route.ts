import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { transitionDispatchStatus, reverseDispatch } from "@/modules/dispatch/dispatch.service";
import { DispatchRepository } from "@/modules/dispatch/dispatch.repository";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "cancel");

    const { id } = await params;
    const existing = await DispatchRepository.findAnyById(session.user.companyId, id);
    if (!existing) {
      throw new BusinessRuleError("NOT_FOUND", "Dispatch not found.", { id });
    }

    const body = await req.json().catch(() => ({}));
    const reason = body?.reason || "Cancelled by user";

    let dispatch;
    if (existing.status === "DISPATCHED" || existing.status === "DELIVERED") {
      dispatch = await reverseDispatch(
        { companyId: session.user.companyId, userId: session.user.id },
        id,
        { reason }
      );
    } else {
      dispatch = await transitionDispatchStatus(
        { companyId: session.user.companyId, userId: session.user.id },
        id,
        "CANCELLED"
      );
    }

    return NextResponse.json({ data: dispatch });
  } catch (error) {
    return handleApiError(error);
  }
}

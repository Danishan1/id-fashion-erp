import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getPaymentById } from "@/modules/accounts/payment.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// No PATCH here — deliberately. No updatePayment exists (see
// payment.service.ts's doc comment): the only DRAFT-stage correction is
// cancel-and-recreate.
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payments", "view");

    const { id } = await params;
    const payment = await getPaymentById(session.user.companyId, id);

    return NextResponse.json({ data: payment });
  } catch (error) {
    return handleApiError(error);
  }
}

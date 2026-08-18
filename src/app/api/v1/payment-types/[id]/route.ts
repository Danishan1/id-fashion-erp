import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { paymentTypeSchema } from "@/modules/finance-config/finance-config.schema";
import { updatePaymentType } from "@/modules/finance-config/finance-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = paymentTypeSchema.parse(await req.json());
    const paymentType = await updatePaymentType({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: paymentType });
  } catch (error) {
    return handleApiError(error);
  }
}

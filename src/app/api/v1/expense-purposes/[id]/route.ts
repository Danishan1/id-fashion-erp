import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { expensePurposeSchema } from "@/modules/finance-config/finance-config.schema";
import { updateExpensePurpose } from "@/modules/finance-config/payee-purpose.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = expensePurposeSchema.parse(await req.json());
    const purpose = await updateExpensePurpose({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: purpose });
  } catch (error) {
    return handleApiError(error);
  }
}

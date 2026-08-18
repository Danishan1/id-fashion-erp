import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { bankAccountSchema } from "@/modules/finance-config/finance-config.schema";
import { updateBankAccount } from "@/modules/finance-config/finance-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = bankAccountSchema.parse(await req.json());
    const bankAccount = await updateBankAccount({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: bankAccount });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { payeeSchema } from "@/modules/finance-config/finance-config.schema";
import { updatePayee } from "@/modules/finance-config/payee-purpose.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = payeeSchema.parse(await req.json());
    const payee = await updatePayee({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: payee });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { taxTypeSchema } from "@/modules/accounts/tax-config.schema";
import { updateTaxType } from "@/modules/accounts/tax-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const input = taxTypeSchema.parse(await req.json());
    const taxType = await updateTaxType({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: taxType });
  } catch (error) {
    return handleApiError(error);
  }
}

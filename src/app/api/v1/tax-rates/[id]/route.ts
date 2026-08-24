import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { taxRateSchema } from "@/modules/accounts/tax-config.schema";
import { updateTaxRate } from "@/modules/accounts/tax-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const input = taxRateSchema.parse(await req.json());
    const rate = await updateTaxRate({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: rate });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { taxRateStatusSchema } from "@/modules/accounts/tax-config.schema";
import { setTaxRateActiveStatus } from "@/modules/accounts/tax-config.service";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const { isActive } = taxRateStatusSchema.parse(await req.json());
    const rate = await setTaxRateActiveStatus({ companyId: session.user.companyId, userId: session.user.id }, id, isActive);

    return NextResponse.json({ data: rate });
  } catch (error) {
    return handleApiError(error);
  }
}

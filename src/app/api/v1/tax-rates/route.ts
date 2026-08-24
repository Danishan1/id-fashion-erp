import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { taxRateSchema } from "@/modules/accounts/tax-config.schema";
import { createTaxRate, listTaxRates } from "@/modules/accounts/tax-config.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const taxTypeId = req.nextUrl.searchParams.get("taxTypeId") || undefined;
    const data = await listTaxRates(session.user.companyId, taxTypeId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "create");

    const input = taxRateSchema.parse(await req.json());
    const rate = await createTaxRate({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: rate }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

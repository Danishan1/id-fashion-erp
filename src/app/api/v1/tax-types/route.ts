import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { taxTypeSchema } from "@/modules/accounts/tax-config.schema";
import { createTaxType, listTaxTypes } from "@/modules/accounts/tax-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const data = await listTaxTypes(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "create");

    const input = taxTypeSchema.parse(await req.json());
    const taxType = await createTaxType({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: taxType }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

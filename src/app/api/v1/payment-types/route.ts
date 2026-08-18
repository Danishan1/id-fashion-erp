import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { paymentTypeSchema } from "@/modules/finance-config/finance-config.schema";
import { listPaymentTypes, createPaymentType } from "@/modules/finance-config/finance-config.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "view");
    return NextResponse.json({ data: await listPaymentTypes(session.user.companyId) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "create");

    const input = paymentTypeSchema.parse(await req.json());
    const paymentType = await createPaymentType({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: paymentType }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { paymentSchema } from "@/modules/accounts/payment.schema";
import { createPayment, listPayments } from "@/modules/accounts/payment.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payments", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "paymentDate");
    const { data, totalCount } = await listPayments(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payments", "create");

    const input = paymentSchema.parse(await req.json());
    const payment = await createPayment(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: payment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import {
  createPaymentRequestSchema,
  paymentRequestListFiltersSchema,
} from "@/modules/accounts/payment-requests/payment-request.schema";
import { createPaymentRequest, listPaymentRequests } from "@/modules/accounts/payment-requests/payment-request.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_requests", "view");

    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, "createdAt");
    const filters = paymentRequestListFiltersSchema.parse({
      group: params.get("group") || undefined,
      requestType: params.get("requestType") || undefined,
      view: params.get("view") || undefined,
    });
    const { data, totalCount } = await listPaymentRequests(
      { companyId: session.user.companyId, userId: session.user.id },
      query,
      filters
    );

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_requests", "create");

    const input = createPaymentRequestSchema.parse(await req.json());
    const request = await createPaymentRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

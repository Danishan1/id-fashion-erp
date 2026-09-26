import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createJobWorkOrderSchema } from "@/modules/production/job-work-order.schema";
import { createJobWorkOrder, listJobWorkOrders } from "@/modules/production/job-work-order.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const contractorId = req.nextUrl.searchParams.get("contractorId") || undefined;
    const overdueOnly = req.nextUrl.searchParams.get("overdueOnly") === "true";

    const { data, totalCount } = await listJobWorkOrders(session.user.companyId, { ...query, contractorId, overdueOnly }, session.user.id);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "create");

    const input = createJobWorkOrderSchema.parse(await req.json());
    const order = await createJobWorkOrder(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: order }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createLeaveRequestSchema } from "@/modules/hrms/leave.schema";
import { createLeaveRequest, listLeaveRequests } from "@/modules/hrms/leave.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const { data, totalCount } = await listLeaveRequests(session.user.companyId, query, status);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "hrms_leave", "create");

    const input = createLeaveRequestSchema.parse(await req.json());
    const request = await createLeaveRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

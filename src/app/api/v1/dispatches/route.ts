import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { dispatchSchema } from "@/modules/dispatch/dispatch.schema";
import { createDispatch, listDispatches } from "@/modules/dispatch/dispatch.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "dispatchDate");
    const { data, totalCount } = await listDispatches({ companyId: session.user.companyId, userId: session.user.id }, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "dispatch", "create");

    const input = dispatchSchema.parse(await req.json());
    const dispatch = await createDispatch(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: dispatch }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

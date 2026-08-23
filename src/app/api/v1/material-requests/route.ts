import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { materialRequestSchema } from "@/modules/inventory/material-request.schema";
import { createMaterialRequest, listMaterialRequests } from "@/modules/inventory/material-request.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const { data, totalCount } = await listMaterialRequests(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const input = materialRequestSchema.parse(await req.json());
    const request = await createMaterialRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

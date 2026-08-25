import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { departmentSchema } from "@/modules/departments/department.schema";
import { listDepartments, createDepartment } from "@/modules/departments/department.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "name");
    query.take = Math.max(query.take, 200); // departments are few; dropdowns want the full list
    query.pageSize = query.take; // keep `meta` honest about what was actually fetched
    const { data, totalCount } = await listDepartments(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = departmentSchema.parse(await req.json());
    const department = await createDepartment({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: department }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

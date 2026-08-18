import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { employeeSchema } from "@/modules/employees/employee.schema";
import { listEmployees, createEmployee } from "@/modules/employees/employee.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "fullName");
    const { data, totalCount } = await listEmployees(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = employeeSchema.parse(await req.json());
    const employee = await createEmployee({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: employee }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

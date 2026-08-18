import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { customerSchema } from "@/modules/customers/customer.schema";
import { listCustomers, createCustomer } from "@/modules/customers/customer.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "name");
    const { data, totalCount } = await listCustomers(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = customerSchema.parse(await req.json());
    const customer = await createCustomer(
      { companyId: session.user.companyId, userId: session.user.id },
      input
    );

    return NextResponse.json({ data: customer }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

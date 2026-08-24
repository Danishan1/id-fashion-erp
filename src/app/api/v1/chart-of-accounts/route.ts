import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { chartOfAccountSchema } from "@/modules/accounts/chart-of-account.schema";
import { createChartOfAccount, listChartOfAccounts } from "@/modules/accounts/chart-of-account.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "code");
    const { data, totalCount } = await listChartOfAccounts(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "create");

    const input = chartOfAccountSchema.parse(await req.json());
    const account = await createChartOfAccount({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: account }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

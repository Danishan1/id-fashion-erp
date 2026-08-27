import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { internalTransferSchema } from "@/modules/accounts/internal-transfer.schema";
import { createInternalTransfer, listInternalTransfers } from "@/modules/accounts/internal-transfer.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "transferDate");
    const { data, totalCount } = await listInternalTransfers(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "create");

    const input = internalTransferSchema.parse(await req.json());
    const transfer = await createInternalTransfer(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: transfer }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

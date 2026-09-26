import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { contractorSchema } from "@/modules/contractors/contractor.schema";
import { listContractors, createContractor } from "@/modules/contractors/contractor.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "name");
    const { data, totalCount } = await listContractors(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "create");

    const input = contractorSchema.parse(await req.json());
    const contractor = await createContractor(
      { companyId: session.user.companyId, userId: session.user.id },
      input
    );

    return NextResponse.json({ data: contractor }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

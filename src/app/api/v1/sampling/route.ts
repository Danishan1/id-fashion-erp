import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { sampleRequestListFiltersSchema, sampleRequestSchema } from "@/modules/sampling/sample.schema";
import { createSampleRequest, listSampleRequests } from "@/modules/sampling/sample.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "view");

    const params = req.nextUrl.searchParams;
    // Default sort is requestDate desc — the worklist's "latest requested
    // first" requirement — via parseListQuery's own sortOrder default.
    const query = parseListQuery(params, "requestDate");
    const filters = sampleRequestListFiltersSchema.parse({
      customerId: params.get("customerId") || undefined,
      buyerId: params.get("buyerId") || undefined,
      styleSearch: params.get("styleSearch") || undefined,
      status: params.get("status") || undefined,
      sampleType: params.get("sampleType") || undefined,
      requestedByUserId: params.get("requestedByUserId") || undefined,
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      color: params.get("color") || undefined,
    });

    const { data, totalCount } = await listSampleRequests(session.user.companyId, query, filters);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "sampling", "create");

    const input = sampleRequestSchema.parse(await req.json());
    const request = await createSampleRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: request }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

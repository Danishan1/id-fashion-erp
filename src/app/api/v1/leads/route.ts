import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { createLeadSchema } from "@/modules/crm/lead.schema";
import { createLead, listLeads } from "@/modules/crm/lead.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const sp = req.nextUrl.searchParams;
    const { data, totalCount } = await listLeads(session.user.companyId, query, {
      stageId: sp.get("stageId") ?? undefined,
      sourceId: sp.get("sourceId") ?? undefined,
      priority: sp.get("priority") ?? undefined,
      assignedToUserId: sp.get("assignedToUserId") ?? undefined,
      country: sp.get("country") ?? undefined,
      segment: sp.get("segment") ?? undefined,
      createdFrom: sp.get("createdFrom") ?? undefined,
      createdTo: sp.get("createdTo") ?? undefined,
    });

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "create");

    const input = createLeadSchema.parse(await req.json());
    const lead = await createLead(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: lead }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { journalSchema } from "@/modules/accounts/journal.schema";
import { createJournal, listJournals } from "@/modules/accounts/journal.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "journalDate");
    const { data, totalCount } = await listJournals({ companyId: session.user.companyId, userId: session.user.id }, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "create");

    const input = journalSchema.parse(await req.json());
    const journal = await createJournal(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: journal }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

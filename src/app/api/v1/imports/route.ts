import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { runImportSchema } from "@/modules/import/import.schema";
import { listImportBatches, runImport } from "@/modules/import/import.service";

// LEAD/DEAL live under the `crm` module, CAMPAIGN_DAILY_METRIC under
// `marketing` — matches the exact action each type's own manual-create route
// already asserts (crm.create for Lead/Deal, marketing.edit for a daily
// metric), so a CSV import can never grant more than the equivalent manual
// action already would.
const PERMISSION_BY_IMPORT_TYPE = {
  LEAD: { module: "crm", action: "create" },
  DEAL: { module: "crm", action: "create" },
  CAMPAIGN_DAILY_METRIC: { module: "marketing", action: "edit" },
} as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "createdAt");
    const { data, totalCount } = await listImportBatches(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const input = runImportSchema.parse(await req.json());

    const permission = PERMISSION_BY_IMPORT_TYPE[input.importType];
    await PermissionService.assert(session.user.id, permission.module, permission.action);

    if (input.rows.length > 0 && Object.keys(input.rows[0]).length === 0) {
      throw new BusinessRuleError("VALIDATION_ERROR", "No columns were mapped — map at least the required columns before importing.");
    }

    const result = await runImport(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

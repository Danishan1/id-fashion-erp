import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { createCrmActivitySchema, CRM_RELATED_MODULES } from "@/modules/crm/crm-activity.schema";
import { addCrmActivity, listCrmActivities } from "@/modules/crm/crm-activity.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");

    const relatedModule = req.nextUrl.searchParams.get("relatedModule");
    const relatedRecordId = req.nextUrl.searchParams.get("relatedRecordId");
    if (!relatedModule || !relatedRecordId || !CRM_RELATED_MODULES.includes(relatedModule as (typeof CRM_RELATED_MODULES)[number])) {
      throw new BusinessRuleError("VALIDATION_ERROR", "relatedModule and relatedRecordId are required.", {});
    }

    const activities = await listCrmActivities(session.user.companyId, relatedModule as never, relatedRecordId);

    return NextResponse.json({ data: activities });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const input = createCrmActivitySchema.parse(await req.json());
    const activity = await addCrmActivity(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: activity }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

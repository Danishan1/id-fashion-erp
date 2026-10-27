import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approvalRuleSchema } from "@/modules/accounts/payment-requests/approval-matrix.schema";
import { createApprovalRule, listApprovalRules } from "@/modules/accounts/payment-requests/approval-matrix.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_request_settings", "view");

    const data = await listApprovalRules({ companyId: session.user.companyId, userId: session.user.id });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_request_settings", "edit");

    const input = approvalRuleSchema.parse(await req.json());
    const rule = await createApprovalRule({ companyId: session.user.companyId, userId: session.user.id }, input);
    return NextResponse.json({ data: rule }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approvalRuleSchema, approvalRuleStatusSchema } from "@/modules/accounts/payment-requests/approval-matrix.schema";
import { setApprovalRuleActive, updateApprovalRule } from "@/modules/accounts/payment-requests/approval-matrix.service";

/** Full replace of the rule (fields + approvers). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_request_settings", "edit");

    const { ruleId } = await params;
    const input = approvalRuleSchema.parse(await req.json());
    const rule = await updateApprovalRule({ companyId: session.user.companyId, userId: session.user.id }, ruleId, input);
    return NextResponse.json({ data: rule });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Activate / deactivate only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ ruleId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "payment_request_settings", "edit");

    const { ruleId } = await params;
    const { isActive } = approvalRuleStatusSchema.parse(await req.json());
    const rule = await setApprovalRuleActive({ companyId: session.user.companyId, userId: session.user.id }, ruleId, isActive);
    return NextResponse.json({ data: rule });
  } catch (error) {
    return handleApiError(error);
  }
}

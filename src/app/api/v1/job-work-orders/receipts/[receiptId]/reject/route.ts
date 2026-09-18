import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { rejectJobWorkReceiptSchema } from "@/modules/production/job-work-order.schema";
import { rejectJobWorkReceipt } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ receiptId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const { receiptId } = await params;
    const input = rejectJobWorkReceiptSchema.parse(await req.json());
    const receipt = await rejectJobWorkReceipt(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      receiptId,
      input.approvalRemark
    );

    return NextResponse.json({ data: receipt });
  } catch (error) {
    return handleApiError(error);
  }
}

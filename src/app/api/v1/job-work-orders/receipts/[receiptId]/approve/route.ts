import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { approveJobWorkReceiptSchema } from "@/modules/production/job-work-order.schema";
import { approveJobWorkReceipt } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ receiptId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "approve");

    const { receiptId } = await params;
    const input = approveJobWorkReceiptSchema.parse(await req.json().catch(() => ({})));
    const receipt = await approveJobWorkReceipt(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      receiptId,
      input
    );

    return NextResponse.json({ data: receipt });
  } catch (error) {
    return handleApiError(error);
  }
}

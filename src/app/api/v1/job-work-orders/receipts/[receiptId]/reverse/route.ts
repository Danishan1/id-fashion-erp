import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { reverseJobWorkReceiptSchema } from "@/modules/production/job-work-order.schema";
import { reverseJobWorkReceipt } from "@/modules/production/job-work-order.service";

interface RouteContext {
  params: Promise<{ receiptId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "edit");

    const { receiptId } = await params;
    const input = reverseJobWorkReceiptSchema.parse(await req.json());
    await reverseJobWorkReceipt(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      receiptId,
      input.reason
    );

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    return handleApiError(error);
  }
}

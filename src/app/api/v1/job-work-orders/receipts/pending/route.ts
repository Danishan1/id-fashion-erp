import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { listPendingJobWorkReceipts } from "@/modules/production/job-work-order.service";

export async function GET() {
  try {
    const session = await requireSession();
    const data = await listPendingJobWorkReceipts({
      companyId: session.user.companyId,
      userId: session.user.id,
      branchId: session.user.defaultBranchId,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { listPendingProgressEntries } from "@/modules/production/job-order.service";

// listPendingProgressEntries() itself asserts "production.approve" — no
// separate route-level check needed, same shape as forwardJobOrder's route.
export async function GET() {
  try {
    const session = await requireSession();

    const entries = await listPendingProgressEntries({
      companyId: session.user.companyId,
      userId: session.user.id,
      branchId: session.user.defaultBranchId,
    });

    return NextResponse.json({ data: entries });
  } catch (error) {
    return handleApiError(error);
  }
}

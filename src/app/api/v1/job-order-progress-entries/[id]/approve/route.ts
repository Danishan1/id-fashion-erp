import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { decideProgressEntrySchema } from "@/modules/production/production.schema";
import { approveProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// approveProgressEntry() itself asserts "production.approve" with
// resourceContext.createdBy, which is what enforces self-approval — whoever
// recorded the entry (recordedByUserId) cannot also be the one approving it,
// matching approveExpense's precedent.
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const input = decideProgressEntrySchema.parse(await req.json());
    const entry = await approveProgressEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}

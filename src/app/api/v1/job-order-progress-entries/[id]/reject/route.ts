import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { rejectProgressEntrySchema } from "@/modules/production/production.schema";
import { rejectProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// rejectProgressEntry() itself asserts "production.approve" (not
// self-approval-guarded — matches Expense's/Sampling's precedent that only
// the Approve branch carries that guard).
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const input = rejectProgressEntrySchema.parse(await req.json());
    const entry = await rejectProgressEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}

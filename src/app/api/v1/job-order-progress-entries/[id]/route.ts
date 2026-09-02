import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { updatePendingProgressEntrySchema } from "@/modules/production/production.schema";
import { updatePendingProgressEntry } from "@/modules/production/job-order.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// updatePendingProgressEntry() itself asserts "production.approve" — a
// Supervisor can correct a worker's quantities/remark only while the entry
// is still PENDING, before deciding it (see the function's own doc comment).
export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { id } = await params;
    const input = updatePendingProgressEntrySchema.parse(await req.json());
    const entry = await updatePendingProgressEntry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: entry });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { postJournal } from "@/modules/accounts/journal.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // Coarse gate here; postJournal() re-asserts "post" internally with
    // resourceContext.createdBy once it knows who created the journal, which
    // is what actually enforces the self-approval guard.
    await PermissionService.assert(session.user.id, "accounts", "post");

    const { id } = await params;
    const journal = await postJournal({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: journal });
  } catch (error) {
    return handleApiError(error);
  }
}

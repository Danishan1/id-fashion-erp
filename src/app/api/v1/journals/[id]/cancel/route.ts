import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelJournal } from "@/modules/accounts/journal.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "cancel");

    const { id } = await params;
    const journal = await cancelJournal({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: journal });
  } catch (error) {
    return handleApiError(error);
  }
}

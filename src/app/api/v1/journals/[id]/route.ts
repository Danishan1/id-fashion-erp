import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { journalSchema } from "@/modules/accounts/journal.schema";
import { getJournalById, updateJournal } from "@/modules/accounts/journal.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "view");

    const { id } = await params;
    const journal = await getJournalById({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: journal });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "accounts", "edit");

    const { id } = await params;
    const input = journalSchema.parse(await req.json());
    const journal = await updateJournal({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: journal });
  } catch (error) {
    return handleApiError(error);
  }
}

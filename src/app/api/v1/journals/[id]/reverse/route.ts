import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { reverseJournalSchema } from "@/modules/accounts/journal.schema";
import { reverseJournal } from "@/modules/accounts/journal.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    // reverseJournal() itself asserts "accounts"/"cancel" internally — no
    // separate "reverse" action exists in the closed ACTIONS union, and
    // "cancel" already matches "gated to Accounts Manager+" per CLAUDE.md.

    const { id } = await params;
    const input = reverseJournalSchema.parse(await req.json().catch(() => ({})));
    const result = await reverseJournal(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}

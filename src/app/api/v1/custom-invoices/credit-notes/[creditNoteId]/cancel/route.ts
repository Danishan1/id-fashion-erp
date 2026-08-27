import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelCustomInvoiceCreditNote } from "@/modules/accounts/custom-invoice-credit-note.service";

interface RouteContext {
  params: Promise<{ creditNoteId: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "cancel");

    const { creditNoteId } = await params;
    const creditNote = await cancelCustomInvoiceCreditNote({ companyId: session.user.companyId, userId: session.user.id }, creditNoteId);

    return NextResponse.json({ data: creditNote });
  } catch (error) {
    return handleApiError(error);
  }
}

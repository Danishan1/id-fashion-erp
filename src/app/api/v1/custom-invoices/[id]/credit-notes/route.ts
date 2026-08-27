import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { customInvoiceCreditNoteSchema } from "@/modules/accounts/custom-invoice-credit-note.schema";
import { issueCustomInvoiceCreditNote } from "@/modules/accounts/custom-invoice-credit-note.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "create");

    const { id } = await params;
    const input = customInvoiceCreditNoteSchema.parse(await req.json());
    const creditNote = await issueCustomInvoiceCreditNote(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: creditNote }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getCreditNoteByIdForPdf } from "@/modules/accounts/custom-invoice-credit-note.service";
import {
  renderCreditNotePdfBuffer,
  type CreditNotePdfData,
} from "@/modules/accounts/custom-invoice-credit-note-pdf";

interface RouteContext {
  params: Promise<{ creditNoteId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const { creditNoteId } = await params;
    const creditNote = await getCreditNoteByIdForPdf(session.user.companyId, creditNoteId);

    const action = req.nextUrl.searchParams.get("action");
    const dispositionParam = req.nextUrl.searchParams.get("disposition");
    const isPrintOrInline = action === "print" || dispositionParam === "inline";
    const disposition = isPrintOrInline ? "inline" : "attachment";

    const buffer = await renderCreditNotePdfBuffer(creditNote as unknown as CreditNotePdfData);
    const fileName = `${creditNote.creditNoteNumber}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { CustomInvoiceRepository } from "@/modules/accounts/custom-invoice.repository";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const number = req.nextUrl.searchParams.get("number")?.trim();
    if (!number) {
      return NextResponse.json({
        data: {
          available: false,
          message: "Invoice number is required.",
        },
      });
    }

    const excludeId = req.nextUrl.searchParams.get("excludeId")?.trim() || undefined;
    const existing = await CustomInvoiceRepository.findByInvoiceNumber(session.user.companyId, number, excludeId);

    if (existing) {
      return NextResponse.json({
        data: {
          available: false,
          message: `Invoice number "${number}" is already in use.`,
        },
      });
    }

    return NextResponse.json({
      data: {
        available: true,
        message: `Invoice number "${number}" is available.`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

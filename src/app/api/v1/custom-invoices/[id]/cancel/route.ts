import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelCustomInvoice } from "@/modules/accounts/custom-invoice.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "cancel");

    const { id } = await params;
    const invoice = await cancelCustomInvoice({ companyId: session.user.companyId, userId: session.user.id }, id);

    return NextResponse.json({ data: invoice });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { invoiceSeriesSchema } from "@/modules/accounts/invoice-series.schema";
import { updateInvoiceSeries } from "@/modules/accounts/invoice-series.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "edit");

    const { id } = await params;
    const input = invoiceSeriesSchema.parse(await req.json());
    const series = await updateInvoiceSeries({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: series });
  } catch (error) {
    return handleApiError(error);
  }
}

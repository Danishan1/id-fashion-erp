import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { invoiceSeriesSchema } from "@/modules/accounts/invoice-series.schema";
import { createInvoiceSeries, listInvoiceSeries } from "@/modules/accounts/invoice-series.service";

export async function GET() {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "view");

    const data = await listInvoiceSeries(session.user.companyId);
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_finance", "create");

    const input = invoiceSeriesSchema.parse(await req.json());
    const series = await createInvoiceSeries({ companyId: session.user.companyId, userId: session.user.id }, input);

    return NextResponse.json({ data: series }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

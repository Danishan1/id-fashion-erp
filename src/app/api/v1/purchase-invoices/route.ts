import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { purchaseInvoiceSchema } from "@/modules/accounts/purchase-invoice.schema";
import { createPurchaseInvoice, listPurchaseInvoices } from "@/modules/accounts/purchase-invoice.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "invoiceDate");
    const { data, totalCount } = await listPurchaseInvoices({ companyId: session.user.companyId, userId: session.user.id }, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "create");

    const input = purchaseInvoiceSchema.parse(await req.json());
    const invoice = await createPurchaseInvoice(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

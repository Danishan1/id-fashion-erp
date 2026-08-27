import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { customInvoiceSchema } from "@/modules/accounts/custom-invoice.schema";
import { createCustomInvoice, listCustomInvoices } from "@/modules/accounts/custom-invoice.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "invoiceDate");
    const { data, totalCount } = await listCustomInvoices(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "create");

    const input = customInvoiceSchema.parse(await req.json());
    const invoice = await createCustomInvoice(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: invoice }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

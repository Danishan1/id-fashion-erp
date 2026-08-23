import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { parseListQuery, buildListMeta } from "@/lib/list-query";
import { buyerEnquirySchema } from "@/modules/buyer-enquiries/buyer-enquiry.schema";
import { createBuyerEnquiry, listBuyerEnquiries } from "@/modules/buyer-enquiries/buyer-enquiry.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "buyer_enquiries", "view");

    const query = parseListQuery(req.nextUrl.searchParams, "enquiryDate");
    const { data, totalCount } = await listBuyerEnquiries(session.user.companyId, query);

    return NextResponse.json({ data, meta: buildListMeta(totalCount, query.page, query.pageSize) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "buyer_enquiries", "create");

    const input = buyerEnquirySchema.parse(await req.json());
    const enquiry = await createBuyerEnquiry(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      input
    );

    return NextResponse.json({ data: enquiry }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

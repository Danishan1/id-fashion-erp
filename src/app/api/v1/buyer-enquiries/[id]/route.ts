import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getBuyerEnquiryById } from "@/modules/buyer-enquiries/buyer-enquiry.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "buyer_enquiries", "view");

    const { id } = await params;
    const enquiry = await getBuyerEnquiryById(session.user.companyId, id);

    return NextResponse.json({ data: enquiry });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { linkCustomerToBuyerEnquiry } from "@/modules/buyer-enquiries/buyer-enquiry.service";
import { linkCustomerToEnquirySchema } from "@/modules/buyer-enquiries/buyer-enquiry.schema";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "buyer_enquiries", "edit");

    const { id } = await params;
    const input = linkCustomerToEnquirySchema.parse(await req.json());
    const enquiry = await linkCustomerToBuyerEnquiry(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      input
    );

    return NextResponse.json({ data: enquiry });
  } catch (error) {
    return handleApiError(error);
  }
}

import { NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { cancelBuyerEnquiry } from "@/modules/buyer-enquiries/buyer-enquiry.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "buyer_enquiries", "edit");

    const { id } = await params;
    const enquiry = await cancelBuyerEnquiry(
      { companyId: session.user.companyId, userId: session.user.id },
      id
    );

    return NextResponse.json({ data: enquiry });
  } catch (error) {
    return handleApiError(error);
  }
}

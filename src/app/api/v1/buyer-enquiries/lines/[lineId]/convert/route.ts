import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { convertEnquiryLineSchema } from "@/modules/buyer-enquiries/buyer-enquiry.schema";
import { convertEnquiryLineToSampleRequest } from "@/modules/buyer-enquiries/buyer-enquiry.service";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    // Matches convertSampleToStyle()'s own precedent — conversion is gated on
    // "edit", not a separate "convert" action (this codebase's ACTIONS list
    // has no such action, and adding one for a single call site elsewhere
    // wasn't judged worth the extra RBAC surface either).
    await PermissionService.assert(session.user.id, "buyer_enquiries", "edit");

    const { lineId } = await params;
    const input = convertEnquiryLineSchema.parse(await req.json());
    const result = await convertEnquiryLineToSampleRequest(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      lineId,
      input
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

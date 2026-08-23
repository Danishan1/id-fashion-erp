import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { buyerEnquiryLineStatusChangeSchema } from "@/modules/buyer-enquiries/buyer-enquiry.schema";
import { changeBuyerEnquiryLineStatus } from "@/modules/buyer-enquiries/buyer-enquiry.service";
import { BuyerEnquiryLineRepository } from "@/modules/buyer-enquiries/buyer-enquiry.repository";

interface RouteContext {
  params: Promise<{ lineId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();

    const { lineId } = await params;
    const input = buyerEnquiryLineStatusChangeSchema.parse(await req.json());

    const line = await BuyerEnquiryLineRepository.findWithEnquiryOwner(lineId);
    if (!line || line.buyerEnquiry.companyId !== session.user.companyId) {
      throw new BusinessRuleError("NOT_FOUND", "Buyer enquiry line not found.", { id: lineId });
    }

    // REJECTED is gated on "reject" (a lighter-weight call some roles get
    // without full edit rights, e.g. MANAGEMENT); every other transition
    // (approve-for-sampling, hold, resume) needs "edit" — same split already
    // used by Sampling's own approve/reject vs. edit permission actions.
    const action = input.lineStatus === "REJECTED" ? "reject" : "edit";
    await PermissionService.assert(session.user.id, "buyer_enquiries", action);

    const updated = await changeBuyerEnquiryLineStatus(
      { companyId: session.user.companyId, userId: session.user.id },
      lineId,
      input
    );

    return NextResponse.json({ data: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

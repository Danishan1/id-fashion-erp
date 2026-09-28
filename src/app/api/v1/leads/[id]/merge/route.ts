import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createLeadSchema } from "@/modules/crm/lead.schema";
import { mergeEnquiryIntoLead } from "@/modules/crm/lead.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = createLeadSchema.parse(await req.json());
    const lead = await mergeEnquiryIntoLead({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: lead });
  } catch (error) {
    return handleApiError(error);
  }
}

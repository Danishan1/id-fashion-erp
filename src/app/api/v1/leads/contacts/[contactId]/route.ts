import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { deleteLeadContact, leadContactSchema, updateLeadContact } from "@/modules/crm/lead-contact.service";

interface RouteContext {
  params: Promise<{ contactId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");
    const { contactId } = await params;
    const input = leadContactSchema.parse(await req.json());
    const contact = await updateLeadContact({ companyId: session.user.companyId, userId: session.user.id }, contactId, input);
    return NextResponse.json({ data: contact });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");
    const { contactId } = await params;
    return NextResponse.json({ data: await deleteLeadContact({ companyId: session.user.companyId, userId: session.user.id }, contactId) });
  } catch (error) {
    return handleApiError(error);
  }
}

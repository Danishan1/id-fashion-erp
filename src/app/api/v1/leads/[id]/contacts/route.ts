import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { createLeadContact, leadContactSchema, listLeadContacts } from "@/modules/crm/lead-contact.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "view");
    const { id } = await params;
    return NextResponse.json({ data: await listLeadContacts(session.user.companyId, id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");
    const { id } = await params;
    const input = leadContactSchema.parse(await req.json());
    const contact = await createLeadContact({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: contact }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

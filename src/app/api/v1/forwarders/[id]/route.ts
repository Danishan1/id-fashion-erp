import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { forwarderUpdateSchema } from "@/modules/forwarders/forwarder.schema";
import { getForwarderById, updateForwarder, deactivateForwarder } from "@/modules/forwarders/forwarder.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "view");

    const { id } = await params;
    const forwarder = await getForwarderById(session.user.companyId, id);
    return NextResponse.json({ data: forwarder });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id } = await params;
    const input = forwarderUpdateSchema.parse(await req.json());
    const forwarder = await updateForwarder({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: forwarder });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "delete");

    const { id } = await params;
    await deactivateForwarder({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}

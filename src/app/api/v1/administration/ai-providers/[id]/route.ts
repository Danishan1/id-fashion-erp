import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { updateAIProviderSchema } from "@/modules/ai-providers/ai-provider.schema";
import { deleteProvider, getProviderById, updateProvider } from "@/modules/ai-providers/ai-provider-admin.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "view");

    const { id } = await params;
    const provider = await getProviderById(session.user.companyId, id);
    return NextResponse.json({ data: provider });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "edit");

    const { id } = await params;
    const input = updateAIProviderSchema.parse(await req.json());
    const provider = await updateProvider({ companyId: session.user.companyId, userId: session.user.id }, id, input);
    return NextResponse.json({ data: provider });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "administration", "delete");

    const { id } = await params;
    await deleteProvider({ companyId: session.user.companyId, userId: session.user.id }, id);
    return NextResponse.json({ data: { id } });
  } catch (error) {
    return handleApiError(error);
  }
}

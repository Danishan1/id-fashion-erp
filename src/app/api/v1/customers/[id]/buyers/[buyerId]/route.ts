import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buyerSchema } from "@/modules/customers/customer.schema";
import { updateBuyer } from "@/modules/customers/customer.service";

interface RouteContext {
  params: Promise<{ id: string; buyerId: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters_core", "edit");

    const { id, buyerId } = await params;
    const input = buyerSchema.parse(await req.json());
    const buyer = await updateBuyer({ companyId: session.user.companyId, userId: session.user.id }, id, buyerId, input);

    return NextResponse.json({ data: buyer });
  } catch (error) {
    return handleApiError(error);
  }
}

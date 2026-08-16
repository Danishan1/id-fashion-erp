import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { buyerSchema } from "@/modules/customers/customer.schema";
import { createBuyer } from "@/modules/customers/customer.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "masters", "create");

    const { id } = await params;
    const input = buyerSchema.parse(await req.json());
    const buyer = await createBuyer({ companyId: session.user.companyId, userId: session.user.id }, id, input);

    return NextResponse.json({ data: buyer }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

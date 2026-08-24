import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { convertDealToCustomerSchema } from "@/modules/crm/deal.schema";
import { convertDealToCustomer } from "@/modules/crm/deal.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "crm", "edit");

    const { id } = await params;
    const input = convertDealToCustomerSchema.parse(await req.json());
    const deal = await convertDealToCustomer(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: deal });
  } catch (error) {
    return handleApiError(error);
  }
}

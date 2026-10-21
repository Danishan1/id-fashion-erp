import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { receiveStockMovementSchema } from "@/modules/inventory/stock-movement.schema";
import { receiveStockMovement } from "@/modules/inventory/stock-movement.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Receive an in-transit raw-material transfer at the chosen destination locations. */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "inventory", "create");

    const { id } = await params;
    const input = receiveStockMovementSchema.parse(await req.json());
    const movement = await receiveStockMovement(
      { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId },
      id,
      input
    );

    return NextResponse.json({ data: movement });
  } catch (error) {
    return handleApiError(error);
  }
}

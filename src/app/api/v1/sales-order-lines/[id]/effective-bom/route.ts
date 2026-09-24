import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { getSalesOrderLineEffectiveBomMaterials } from "@/modules/sales-orders/sales-order-bom-override.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const materials = await getSalesOrderLineEffectiveBomMaterials(
      { companyId: session.user.companyId, userId: session.user.id },
      id
    );

    return NextResponse.json({ data: materials });
  } catch (error) {
    return handleApiError(error);
  }
}

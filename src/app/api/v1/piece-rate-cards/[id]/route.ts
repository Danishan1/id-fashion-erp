import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { pieceRateCardSchema } from "@/modules/production/production.schema";
import { updatePieceRateCard } from "@/modules/production/piece-rate-card.service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "rate_card", "edit");

    const { id } = await params;
    const input = pieceRateCardSchema.parse(await req.json());
    const card = await updatePieceRateCard(
      { companyId: session.user.companyId, userId: session.user.id },
      id,
      {
        productionOperationId: input.productionOperationId,
        productId: input.productId || null,
        employeeId: input.employeeId || null,
        employeeCategoryId: input.employeeCategoryId || null,
        rate: input.rate,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || null,
      }
    );
    return NextResponse.json({ data: card });
  } catch (error) {
    return handleApiError(error);
  }
}

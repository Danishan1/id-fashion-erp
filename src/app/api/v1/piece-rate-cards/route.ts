import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { pieceRateCardSchema } from "@/modules/production/production.schema";
import { listPieceRateCards, createPieceRateCard } from "@/modules/production/piece-rate-card.service";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "rate_card", "view");

    const params = req.nextUrl.searchParams;
    const data = await listPieceRateCards(session.user.companyId, {
      productId: params.get("productId") || undefined,
      productionOperationId: params.get("productionOperationId") || undefined,
      employeeId: params.get("employeeId") || undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "rate_card", "create");

    const input = pieceRateCardSchema.parse(await req.json());
    const card = await createPieceRateCard(
      { companyId: session.user.companyId, userId: session.user.id },
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
    return NextResponse.json({ data: card }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

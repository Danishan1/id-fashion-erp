import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { resolvePieceRateSchema } from "@/modules/production/production.schema";
import { resolvePieceRate } from "@/modules/production/piece-rate-resolution.service";
import { ProductionOrderRepository, JobOrderRepository } from "@/modules/production/production.repository";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/** The assignment-time preview endpoint — backs the "Resolved Rate / Source
 * / Estimated Earning" display in the Assign Worker modal. Never mutates
 * anything; assignWorker() re-resolves for real at the moment of assignment. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "piece_rate", "view");

    const input = resolvePieceRateSchema.parse(await req.json());
    const jobOrder = await JobOrderRepository.findAnyById(session.user.companyId, input.jobOrderId);
    if (!jobOrder) throw new BusinessRuleError("NOT_FOUND", "Job order not found.", { id: input.jobOrderId });

    const order = await ProductionOrderRepository.findAnyById(session.user.companyId, jobOrder.productionOrderId);
    const resolution = await resolvePieceRate({
      companyId: session.user.companyId,
      productId: order?.productId ?? null,
      productionOperationId: input.productionOperationId,
      employeeId: input.employeeId,
      asOfDate: new Date(),
    });

    return NextResponse.json({ data: resolution });
  } catch (error) {
    return handleApiError(error);
  }
}

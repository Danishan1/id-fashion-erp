import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { assertLotInScope } from "@/modules/production/production-scope";
import { getJobOrderById } from "@/modules/production/job-order.service";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { ProductionStageTransactionRepository } from "@/modules/production/production.repository";
import { getCompanyHeaderLines } from "@/core/documents/company-header";
import { renderSlipPdf, slipPdfHeaders, type SlipDescriptor } from "@/core/documents/slip-pdf";

interface RouteContext {
  params: Promise<{ id: string; jobOrderId: string }>;
}

/**
 * The physical/digital "Production Slip" this project's own Domain
 * Reference section calls for — the ticket that travels with a lot as it
 * moves between stages. Anchored on the JobOrder that received the
 * transfer (the "to" side) — a floor worker downloads this from the job
 * order they're now holding, not from the one they forwarded away from.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id: lotId, jobOrderId } = await params;
    await assertLotInScope({ companyId: session.user.companyId, userId: session.user.id }, lotId);
    // A worker may only download the slip for a job order they are assigned to.
    await getJobOrderById(session.user.companyId, jobOrderId, session.user.id);
    const transaction = await ProductionStageTransactionRepository.findLatestByToJobOrderId(session.user.companyId, lotId, jobOrderId);
    if (!transaction) {
      throw new BusinessRuleError(
        "NOT_FOUND",
        "No stage transfer record exists for this job order yet — a slip is only available once material has actually been forwarded into it."
      );
    }

    const { companyName } = await getCompanyHeaderLines(session.user.companyId);

    const receivingWorkers = transaction.toJobOrder.assignments.map((a) => a.employee.fullName);

    const descriptor: SlipDescriptor = {
      companyName,
      slipTitle: "Stage Transfer Slip",
      slipNumber: `${transaction.lot.lotNumber} · ${transaction.toProductionStage.name}`,
      fields: [
        { label: "Production Order", value: transaction.productionOrder.orderNumber },
        {
          label: "Sales Order",
          value: transaction.productionOrder.salesOrderItem?.salesOrder.orderNumber ?? "— (Make-to-Stock, no Sales Order)",
        },
        { label: "Style", value: `${transaction.productionOrder.product.styleName} (${transaction.productionOrder.product.styleCode})` },
        { label: "Lot No.", value: transaction.lot.lotNumber },
        { label: "From Stage", value: transaction.fromProductionStage?.name ?? "— (first stage)" },
        { label: "To Stage", value: transaction.toProductionStage.name },
        { label: "Quantity", value: Number(transaction.quantity).toLocaleString("en-IN") },
        { label: "Transaction Type", value: transaction.transactionType },
        { label: "Forwarded By", value: transaction.performedBy.fullName },
        { label: "Received By (Assigned Worker)", value: receivingWorkers.length > 0 ? receivingWorkers.join(", ") : "Not yet assigned" },
        { label: "Performed At", value: new Date(transaction.performedAt).toLocaleString("en-IN") },
      ],
      variantBreakdown: transaction.lot.variantBreakdown.map((b) => ({
        colorName: b.productVariant.color.name,
        sizeName: b.productVariant.size.name,
        quantity: Number(b.quantity).toLocaleString("en-IN"),
      })),
      notes: transaction.notes ?? transaction.revertReason ?? null,
      signatureLabels: ["Handed Over By", "Received By"],
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "Unknown",
    };

    const buffer = await renderSlipPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), {
      headers: slipPdfHeaders(`stage-slip-${transaction.lot.lotNumber}-${transaction.toProductionStage.name}.pdf`),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

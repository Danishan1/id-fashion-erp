import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { getJobWorkOrderById } from "@/modules/production/job-work-order.service";
import { getCompanyHeaderLines } from "@/core/documents/company-header";
import { renderSlipPdf, slipPdfHeaders, type SlipDescriptor } from "@/core/documents/slip-pdf";

interface RouteContext {
  params: Promise<{ id: string; receiptId: string }>;
}

/**
 * Job Work Receipt Slip — the counterpart to the Stage Transfer Slip, but
 * for work sent OUT to an external contractor and received back, per the
 * user's own explicit ask ("production ke stages me bhi slip with reciveng
 * pdf me hona chahiye"). Anchored on one specific JobWorkReceipt (a job work
 * order can have several partial receipts over its life).
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "production", "view");

    const { id, receiptId } = await params;
    const jobWorkOrder = await getJobWorkOrderById(session.user.companyId, id, session.user.id);
    const receipt = jobWorkOrder.receipts.find((r) => r.id === receiptId);
    if (!receipt) throw new BusinessRuleError("NOT_FOUND", "Receipt not found on this job work order.", { id: receiptId });

    const { companyName } = await getCompanyHeaderLines(session.user.companyId);

    const descriptor: SlipDescriptor = {
      companyName,
      slipTitle: "Job Work Receipt Slip",
      slipNumber: receipt.receiptNumber,
      fields: [
        { label: "Job Work Order", value: jobWorkOrder.jobWorkNumber },
        { label: "Production Order", value: jobWorkOrder.jobOrder.lot.productionOrder.orderNumber },
        {
          label: "Sales Order",
          value: jobWorkOrder.jobOrder.lot.productionOrder.salesOrderItem?.salesOrder.orderNumber ?? "— (Make-to-Stock, no Sales Order)",
        },
        { label: "Lot No.", value: jobWorkOrder.jobOrder.lot.lotNumber },
        { label: "Against Job Order", value: `${jobWorkOrder.jobOrder.jobNumber} (${jobWorkOrder.jobOrder.productionStage.name})` },
        { label: "Issued By (Sent Out By)", value: jobWorkOrder.requestedBy.fullName },
        { label: "Vendor / Supplier (Sent To)", value: jobWorkOrder.supplier.name },
        { label: "Received Quantity", value: `${Number(receipt.receivedQuantity).toLocaleString("en-IN")} ${jobWorkOrder.uom.code}` },
        { label: "Rejected Quantity", value: `${Number(receipt.rejectedQuantity).toLocaleString("en-IN")} ${jobWorkOrder.uom.code}` },
        { label: "Damaged Quantity", value: `${Number(receipt.damagedQuantity).toLocaleString("en-IN")} ${jobWorkOrder.uom.code}` },
        { label: "Received Date", value: new Date(receipt.receivedDate).toLocaleDateString("en-IN") },
        { label: "Received By (Store)", value: receipt.receivedBy.fullName },
        { label: "Status", value: receipt.status },
      ],
      variantBreakdown: jobWorkOrder.jobOrder.lot.variantBreakdown.map((b) => ({
        colorName: b.productVariant.color.name,
        sizeName: b.productVariant.size.name,
        quantity: Number(b.quantity).toLocaleString("en-IN"),
      })),
      notes: receipt.remarks ?? null,
      signatureLabels: ["Delivered By (Vendor)", "Received By (Store)"],
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "Unknown",
    };

    const buffer = await renderSlipPdf(descriptor);
    return new NextResponse(new Uint8Array(buffer), { headers: slipPdfHeaders(`job-work-receipt-${receipt.receiptNumber}.pdf`) });
  } catch (error) {
    return handleApiError(error);
  }
}

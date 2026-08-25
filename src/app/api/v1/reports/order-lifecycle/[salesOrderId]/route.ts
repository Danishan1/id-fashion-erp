import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { canAccessModule } from "@/core/reports/permissions";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";

/**
 * The one bespoke, non-generic report in this module — a multi-section trace
 * of a single Sales Order through every downstream stage. Gated on `reports.view`
 * only; each section is independently checked against the viewer's real
 * per-module permission and OMITTED (not shown-then-blocked) if they lack it —
 * mirrors getCustomer360()'s multi-section shape, so a Merchandiser without
 * Accounts access still sees every stage they ARE allowed to see instead of
 * being denied the whole report for lacking one stage's permission.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ salesOrderId: string }> }) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "reports", "view");

    const { salesOrderId } = await params;
    const companyId = session.user.companyId;
    const userId = session.user.id;

    const order = await prisma.salesOrder.findFirst({
      where: { id: salesOrderId, companyId },
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        baseTotalAmount: true,
        customer: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            productId: true,
            unitPrice: true,
            sampleRequestId: true,
            product: { select: { styleCode: true, styleName: true } },
            breakdown: { select: { orderedQuantity: true } },
          },
        },
      },
    });
    if (!order) throw new BusinessRuleError("NOT_FOUND", "Sales Order not found.", { id: salesOrderId });

    const itemIds = order.items.map((i) => i.id);
    const sampleRequestIds = order.items.map((i) => i.sampleRequestId).filter((id): id is string => !!id);

    const [canSalesOrders, canSampling, canInventory, canPurchasing, canProduction, canQc, canDispatch, canInvoices, canPayments] = await Promise.all([
      canAccessModule(userId, "sales_orders"),
      canAccessModule(userId, "sampling"),
      canAccessModule(userId, "inventory"),
      canAccessModule(userId, "purchasing"),
      canAccessModule(userId, "production"),
      canAccessModule(userId, "qc"),
      canAccessModule(userId, "dispatch"),
      canAccessModule(userId, "invoices"),
      canAccessModule(userId, "payments"),
    ]);

    const sections: Record<string, unknown> = {};

    if (canSalesOrders) {
      sections.order = {
        id: order.id,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        status: order.status,
        customer: order.customer,
        totalAmount: Number(order.baseTotalAmount),
        items: order.items.map((i) => ({
          styleCode: i.product.styleCode,
          styleName: i.product.styleName,
          unitPrice: Number(i.unitPrice),
          orderedQuantity: i.breakdown.reduce((s, b) => s + b.orderedQuantity, 0),
        })),
      };
    }

    if (canSampling && sampleRequestIds.length > 0) {
      const samples = await prisma.sampleRequest.findMany({
        where: { id: { in: sampleRequestIds }, companyId },
        select: { id: true, requestNumber: true, styleName: true, status: true, sampleType: true },
      });
      sections.sampling = samples;
    } else if (canSampling) {
      sections.sampling = [];
    }

    if (canInventory) {
      const materialRequests = await prisma.materialRequest.findMany({
        where: { salesOrderId, companyId },
        select: {
          id: true,
          requestNumber: true,
          requestType: true,
          warehouse: { select: { name: true } },
          lines: { select: { requestedQuantity: true, issuedQuantity: true, material: { select: { styleName: true } } } },
        },
      });
      sections.materialRequests = materialRequests.map((mr) => ({
        id: mr.id,
        requestNumber: mr.requestNumber,
        requestType: mr.requestType,
        warehouse: mr.warehouse.name,
        lines: mr.lines.map((it) => ({
          material: it.material.styleName,
          requestedQuantity: Number(it.requestedQuantity),
          issuedQuantity: Number(it.issuedQuantity),
        })),
      }));

      if (canPurchasing) {
        const materialRequestIds = materialRequests.map((mr) => mr.id);
        const purchaseOrderItems =
          materialRequestIds.length > 0
            ? await prisma.purchaseOrderItem.findMany({
                where: { materialRequestItem: { materialRequestId: { in: materialRequestIds } } },
                select: {
                  orderedQuantity: true,
                  receivedQuantity: true,
                  product: { select: { styleName: true } },
                  purchaseOrder: { select: { id: true, orderNumber: true, status: true, supplier: { select: { name: true } } } },
                },
              })
            : [];
        sections.purchase = purchaseOrderItems.map((poi) => ({
          purchaseOrderId: poi.purchaseOrder.id,
          orderNumber: poi.purchaseOrder.orderNumber,
          status: poi.purchaseOrder.status,
          supplier: poi.purchaseOrder.supplier.name,
          material: poi.product.styleName,
          orderedQuantity: Number(poi.orderedQuantity),
          receivedQuantity: Number(poi.receivedQuantity),
        }));
      }
    }

    let productionOrderIds: string[] = [];
    if (canProduction) {
      const productionOrders = await prisma.productionOrder.findMany({
        where: { salesOrderItemId: { in: itemIds } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          plannedQuantity: true,
          product: { select: { styleName: true } },
        },
      });
      productionOrderIds = productionOrders.map((p) => p.id);
      sections.production = productionOrders.map((p) => ({
        id: p.id,
        orderNumber: p.orderNumber,
        status: p.status,
        style: p.product.styleName,
        plannedQuantity: Number(p.plannedQuantity),
      }));
    }

    if (canQc) {
      const qcInspections =
        productionOrderIds.length > 0
          ? await prisma.qcInspection.findMany({
              where: { productionOrderId: { in: productionOrderIds } },
              select: { inspectedQuantity: true, acceptedQuantity: true, rejectedQuantity: true, result: true, inspectedAt: true },
              orderBy: { inspectedAt: "desc" },
            })
          : [];
      sections.qc = qcInspections.map((q) => ({
        inspectedAt: q.inspectedAt,
        inspectedQuantity: Number(q.inspectedQuantity),
        acceptedQuantity: Number(q.acceptedQuantity),
        rejectedQuantity: Number(q.rejectedQuantity),
        result: q.result,
      }));
    }

    let dispatchIds: string[] = [];
    if (canDispatch) {
      const dispatches = await prisma.dispatch.findMany({
        where: { salesOrderId, companyId },
        select: { id: true, dispatchNumber: true, dispatchDate: true, status: true, transporterName: true },
      });
      dispatchIds = dispatches.map((d) => d.id);
      const cartons =
        dispatchIds.length > 0
          ? await prisma.carton.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { cartonNumber: true, totalQuantity: true, dispatchId: true } })
          : [];
      sections.dispatch = dispatches.map((d) => ({
        id: d.id,
        dispatchNumber: d.dispatchNumber,
        dispatchDate: d.dispatchDate,
        status: d.status,
        transporterName: d.transporterName,
        cartons: cartons.filter((c) => c.dispatchId === d.id).map((c) => ({ cartonNumber: c.cartonNumber, totalQuantity: c.totalQuantity })),
      }));
    }

    let invoiceIds: string[] = [];
    if (canInvoices) {
      const invoices = await prisma.salesInvoice.findMany({
        where: { salesOrderId, companyId },
        select: { id: true, invoiceNumber: true, invoiceDate: true, status: true, totalAmount: true, paidAmount: true },
      });
      invoiceIds = invoices.map((i) => i.id);
      sections.invoices = invoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        status: i.status,
        totalAmount: Number(i.totalAmount),
        paidAmount: Number(i.paidAmount),
      }));
    }

    if (canPayments && invoiceIds.length > 0) {
      const allocations = await prisma.paymentAllocation.findMany({
        where: { salesInvoiceId: { in: invoiceIds } },
        select: {
          allocatedAmount: true,
          payment: { select: { paymentNumber: true, paymentDate: true, status: true } },
        },
      });
      sections.payments = allocations.map((a) => ({
        paymentNumber: a.payment.paymentNumber,
        paymentDate: a.payment.paymentDate,
        status: a.payment.status,
        allocatedAmount: Number(a.allocatedAmount),
      }));
    } else if (canPayments) {
      sections.payments = [];
    }

    return NextResponse.json({ sections });
  } catch (error) {
    return handleApiError(error);
  }
}

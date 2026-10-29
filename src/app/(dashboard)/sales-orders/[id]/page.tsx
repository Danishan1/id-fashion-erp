import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesOrderById } from "@/modules/sales-orders/sales-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { formatDate } from "@/lib/date-format";
import { SalesOrderWorkflowPanel } from "../SalesOrderWorkflowPanel";

export default async function SalesOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getSalesOrderById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!order) notFound();

  // Made from an accepted quotation (Sales & Marketing S4) — shown for traceability.
  const source = await prisma.salesOrder.findFirst({
    where: { id, companyId: session!.user.companyId },
    select: { sourceQuotationRevision: { select: { revisionNumber: true, quotation: { select: { id: true, quotationNumber: true } } } } },
  });
  const fromQuotation = source?.sourceQuotationRevision ?? null;
  const canViewQuotations = fromQuotation ? await PermissionService.can(session!.user.id, "sales_quotations", "view") : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sales Orders", href: "/sales-orders" }, { label: order.orderNumber }]} />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {order.customer.name}
            {order.buyer ? ` — ${order.buyer.name}` : ""} · Requested by {order.requestedBy.fullName} on{" "}
            {formatDate(order.orderDate)}
            {order.requiredShipDate ? ` · Required ship: ${formatDate(order.requiredShipDate)}` : ""}
            {order.customerPoNumber ? ` · Customer PO: ${order.customerPoNumber}` : ""}
          </p>
          {fromQuotation && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              From quotation{" "}
              {canViewQuotations ? (
                <Link href={`/sales-marketing/quotations/${fromQuotation.quotation.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {fromQuotation.quotation.quotationNumber}
                </Link>
              ) : (
                fromQuotation.quotation.quotationNumber
              )}{" "}
              revision {fromQuotation.revisionNumber}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Scan-to-lookup during production/dispatch — encodes the order number itself, nothing else. */}
          <Barcode value={order.orderNumber} />
          <a
            href={`/api/v1/sales-orders/${id}/pdf`}
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Download PDF
          </a>
        </div>
      </div>

      {/* Prisma Decimal/Date instances aren't plain-serializable across the
          server/client boundary — round-trip through JSON, same pattern as
          Sampling's detail page. `key={id}` forces a remount on client-side
          navigation between two different orders — same stale-data fix
          applied project-wide after the Sampling bug. */}
      <SalesOrderWorkflowPanel key={id} salesOrderId={id} initialOrder={JSON.parse(JSON.stringify(order))} />
    </div>
  );
}

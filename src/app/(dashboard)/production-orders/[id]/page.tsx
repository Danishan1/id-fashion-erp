import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getProductionOrderById } from "@/modules/production/production-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import Link from "next/link";
import { ProductionOrderWorkflowPanel } from "../ProductionOrderWorkflowPanel";
import { getProductionRecordScope } from "@/modules/production/production-scope";

export default async function ProductionOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ extra?: string }>;
}) {
  const { id } = await params;
  const { extra } = await searchParams;
  const session = await auth();

  const order = await getProductionOrderById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!order) notFound();
  // P1: a worker (no production.view_all) gets a read-only list of just the
  // lots carrying their own assignment -- none of the order-level actions.
  const assignedOnly = (await getProductionRecordScope(session!.user.id)).mode === "ASSIGNED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Production Orders", href: "/production-orders" },
              { label: order.orderNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {order.product.styleName} ({order.product.styleCode}) · Requested by {order.requestedBy.fullName}
          </p>
        </div>
        <Barcode value={order.orderNumber} />
      </div>

      {/* Decimal/Date fields round-trip through JSON before crossing to the
          Client Component. key={id} forces a remount on client-side
          navigation between two different orders. */}
      {assignedOnly ? (
        <div className="space-y-3">
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            You are seeing only the lots assigned to you. To record your progress, open{" "}
            <Link href="/production/my-work" className="font-medium underline">
              My Work
            </Link>
            .
          </p>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {order.lots.map((lot) => (
              <li key={lot.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <Link href={`/production-orders/${id}/lots/${lot.id}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                  {lot.lotNumber}
                </Link>
                <span className="text-zinc-600 dark:text-zinc-300">
                  {lot.currentStage?.name ?? "Not started"} · {lot.status.replaceAll("_", " ").toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ProductionOrderWorkflowPanel
          key={id}
          productionOrderId={id}
          initialOrder={JSON.parse(JSON.stringify(order))}
          openExtraOnLoad={extra === "1"}
        />
      )}
    </div>
  );
}

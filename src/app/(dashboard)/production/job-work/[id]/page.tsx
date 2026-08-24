import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getJobWorkOrderById } from "@/modules/production/job-work-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { JobWorkOrderWorkflowPanel } from "./JobWorkOrderWorkflowPanel";

export default async function JobWorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const order = await getJobWorkOrderById(session!.user.companyId, id).catch(() => null);
  if (!order) notFound();

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Job Work Orders", href: "/production/job-work" },
          { label: order.jobWorkNumber },
        ]}
      />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{order.jobWorkNumber}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {order.jobOrder.lot.productionOrder.orderNumber} / {order.jobOrder.lot.lotNumber} — {order.jobOrder.productionStage.name} · Sent to{" "}
          {order.supplier.name}
        </p>
      </div>

      <JobWorkOrderWorkflowPanel key={id} jobWorkOrderId={id} initialOrder={JSON.parse(JSON.stringify(order))} />
    </div>
  );
}

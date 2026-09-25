import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getJobWorkOrderById } from "@/modules/production/job-work-order.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { JobWorkOrderWorkflowPanel } from "./JobWorkOrderWorkflowPanel";

export default async function JobWorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  // Fixed a real gap (RBAC audit, 2026-09-24): this page previously had NO
  // permission check at all, and never passed `userId` into
  // getJobWorkOrderById() for its own External-Unit-User supplier scoping —
  // an external login could view any OTHER supplier's Job Work Order by
  // guessing/knowing its id, and a role with no `production` access at all
  // could still reach this page's data.
  await PermissionService.assert(session!.user.id, "production", "view", {
    sessionIssuedAt: session!.user.sessionIssuedAt,
  }).catch(() => notFound());

  const order = await getJobWorkOrderById(session!.user.companyId, id, session!.user.id).catch(() => null);
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

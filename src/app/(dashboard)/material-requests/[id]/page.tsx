import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getMaterialRequestById } from "@/modules/inventory/material-request.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Barcode } from "@/components/ui/Barcode";
import { MaterialRequestWorkflowPanel } from "../MaterialRequestWorkflowPanel";

export default async function MaterialRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const request = await getMaterialRequestById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!request) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Material Requests", href: "/material-requests" },
              { label: request.requestNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{request.requestNumber}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {request.department ? `${request.department.name} · ` : ""}
            Requested by {request.requestedBy.fullName} · Issue from {request.warehouse.name}
          </p>
        </div>
        <Barcode value={request.requestNumber} />
      </div>

      {/* Decimal/Date fields round-trip through JSON before crossing to the
          Client Component. key={id} forces a remount on client-side
          navigation between two different requests. */}
      <MaterialRequestWorkflowPanel key={id} materialRequestId={id} initialRequest={JSON.parse(JSON.stringify(request))} />
    </div>
  );
}

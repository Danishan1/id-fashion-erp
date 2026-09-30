import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getDispatchById } from "@/modules/dispatch/dispatch.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DispatchForm } from "../../new/DispatchForm";

export default async function EditDispatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const dispatch = await getDispatchById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!dispatch) notFound();

  // Matches the service's own guard — nothing else can be edited here.
  if (dispatch.status !== "DRAFT" && dispatch.status !== "PACKED") notFound();

  const initialDispatch = {
    id: dispatch.id,
    salesOrderId: dispatch.salesOrderId,
    warehouseId: dispatch.warehouseId,
    dispatchDate: dispatch.dispatchDate.toISOString(),
    deliveryAddress: dispatch.deliveryAddress,
    transporterName: dispatch.transporterName,
    vehicleNumber: dispatch.vehicleNumber,
    trackingNumber: dispatch.trackingNumber,
    items: dispatch.items.map((item) => ({
      salesOrderItemId: item.salesOrderItemId,
      dispatchedQuantity: item.dispatchedQuantity,
      extraDispatchReason: item.extraDispatchReason,
      extraDispatchRemarks: item.extraDispatchRemarks,
    })),
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Dispatch", href: "/dispatch" },
          { label: dispatch.dispatchNumber, href: `/dispatch/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {dispatch.dispatchNumber}</h1>
      {/* key={id} forces a remount on client-side navigation between two
          different dispatches' edit pages — same stale-data fix applied
          project-wide after the Sampling bug. */}
      <DispatchForm key={id} initialDispatch={initialDispatch} />
    </div>
  );
}

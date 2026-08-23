import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getMaterialRequestById } from "@/modules/inventory/material-request.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { MaterialRequestForm } from "../../MaterialRequestForm";

export default async function EditMaterialRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const request = await getMaterialRequestById(session!.user.companyId, id).catch(() => null);
  if (!request) notFound();

  // Matches the service's own real-state guard — blocked once anything has
  // actually been issued or escalated, not just by status label (a
  // PARTIALLY_FULFILLED or even nominally-OPEN request can already have
  // real activity on some lines).
  const hasActivity = request.lines.some((line) => Number(line.issuedQuantity) > 0 || line.purchaseOrderItems.length > 0);
  if (request.status === "CANCELLED" || request.status === "CLOSED" || hasActivity) {
    notFound();
  }

  const initialRequest = {
    id: request.id,
    requestType: request.requestType,
    departmentId: request.departmentId,
    warehouseId: request.warehouseId,
    requiredDate: request.requiredDate ? request.requiredDate.toISOString() : null,
    purpose: request.purpose,
    salesOrderId: request.salesOrderId,
    bomId: request.bomId,
    originalMaterialRequestId: request.originalMaterialRequestId,
    originalMaterialRequestNumber: request.originalMaterialRequest?.requestNumber ?? null,
    remarks: request.remarks,
    lines: request.lines.map((line) => ({
      materialId: line.materialId,
      colorId: line.colorId,
      dyeId: line.dyeId,
      uomId: line.uomId,
      requestedQuantity: line.requestedQuantity.toString(),
      damageReason: line.damageReason,
      remarks: line.remarks,
    })),
  };

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Material Requests", href: "/material-requests" },
          { label: request.requestNumber, href: `/material-requests/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {request.requestNumber}</h1>
      <MaterialRequestForm key={id} initialRequest={initialRequest} />
    </div>
  );
}

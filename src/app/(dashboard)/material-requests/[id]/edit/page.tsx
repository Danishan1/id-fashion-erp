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

  // Matches the service's own real-state guard, applied per line (not to
  // the whole request) — a line is locked the moment real stock has been
  // issued against it or a shortfall has been escalated to a Purchase
  // Order. A PARTIALLY_FULFILLED (or even nominally-OPEN) request can freely
  // mix locked and still-editable lines; this page only 404s once there is
  // genuinely nothing left to edit.
  const isLineLocked = (line: (typeof request.lines)[number]) => Number(line.issuedQuantity) > 0 || line.purchaseOrderItems.length > 0;
  const hasEditableLine = request.lines.some((line) => !isLineLocked(line));
  if (request.status === "CANCELLED" || request.status === "CLOSED" || !hasEditableLine) {
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
    // Only the still-unlocked lines are editable — a locked line is
    // preserved untouched server-side and is never part of what this form
    // submits (see material-request.service.ts's updateMaterialRequestLines).
    lines: request.lines
      .filter((line) => !isLineLocked(line))
      .map((line) => ({
        materialId: line.materialId,
        colorId: line.colorId,
        dyeId: line.dyeId,
        uomId: line.uomId,
        requestedQuantity: line.requestedQuantity.toString(),
        damageReason: line.damageReason,
        remarks: line.remarks,
      })),
    // Read-only display only — shown so the user still sees the full
    // request while editing, but never sent back to the server.
    lockedLines: request.lines
      .filter(isLineLocked)
      .map((line) => ({
        materialName: `${line.material.styleName} (${line.material.styleCode})`,
        colorName: line.color?.name ?? null,
        uomCode: line.uom.code,
        requestedQuantity: line.requestedQuantity.toString(),
        issuedQuantity: line.issuedQuantity.toString(),
        lockedReason: line.purchaseOrderItems.length > 0 && Number(line.issuedQuantity) <= 0 ? "escalated to a purchase order" : "already issued",
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

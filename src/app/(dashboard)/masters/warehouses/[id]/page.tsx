import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getWarehouseById } from "@/modules/warehouses/warehouse.service";
import { WarehouseEditFormClient } from "./WarehouseEditFormClient";
import { LocationsSection } from "../LocationsSection";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function EditWarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const warehouse = await getWarehouseById(session!.user.companyId, id).catch(() => null);
  if (!warehouse) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Warehouses", href: "/masters/warehouses" },
            { label: warehouse.name },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{warehouse.name}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Code: {warehouse.code}</p>
      </div>

      <WarehouseEditFormClient
        key={`form-${id}`}
        id={id}
        initialValues={{
          code: warehouse.code,
          name: warehouse.name,
          type: warehouse.type,
          isActive: warehouse.isActive,
        }}
      />

      <LocationsSection key={`locations-${id}`} warehouseId={id} initialLocations={warehouse.locations} />
    </div>
  );
}

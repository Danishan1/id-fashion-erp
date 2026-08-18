import { WarehouseForm } from "../WarehouseForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewWarehousePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Warehouses", href: "/masters/warehouses" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Warehouse</h1>
      <WarehouseForm submitUrl="/api/v1/warehouses" method="POST" redirectTo="/masters/warehouses" />
    </div>
  );
}

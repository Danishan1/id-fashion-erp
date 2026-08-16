import { WarehouseForm } from "../WarehouseForm";

export default function NewWarehousePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Warehouse</h1>
      <WarehouseForm submitUrl="/api/v1/warehouses" method="POST" redirectTo="/masters/warehouses" />
    </div>
  );
}

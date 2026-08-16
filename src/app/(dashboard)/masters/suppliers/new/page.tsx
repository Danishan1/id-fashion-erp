import { SupplierForm } from "../SupplierForm";

export default function NewSupplierPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Supplier</h1>
      <SupplierForm submitUrl="/api/v1/suppliers" method="POST" redirectTo="/masters/suppliers" />
    </div>
  );
}

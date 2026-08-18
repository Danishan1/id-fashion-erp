import { SupplierForm } from "../SupplierForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewSupplierPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Suppliers", href: "/masters/suppliers" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Supplier</h1>
      <SupplierForm submitUrl="/api/v1/suppliers" method="POST" redirectTo="/masters/suppliers" />
    </div>
  );
}

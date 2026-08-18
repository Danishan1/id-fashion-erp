import { CustomerForm } from "../CustomerForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[{ label: "Masters", href: "/masters" }, { label: "Customers", href: "/masters/customers" }, { label: "New" }]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Customer</h1>
      <CustomerForm submitUrl="/api/v1/customers" method="POST" redirectTo="/masters/customers" />
    </div>
  );
}

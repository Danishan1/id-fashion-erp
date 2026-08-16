import { CustomerForm } from "../CustomerForm";

export default function NewCustomerPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Customer</h1>
      <CustomerForm submitUrl="/api/v1/customers" method="POST" redirectTo="/masters/customers" />
    </div>
  );
}

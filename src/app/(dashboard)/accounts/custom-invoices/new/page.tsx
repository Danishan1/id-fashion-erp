import { CustomInvoiceForm } from "./CustomInvoiceForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewCustomInvoicePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Custom Invoices", href: "/accounts/custom-invoices" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Create Invoice</h1>
      <CustomInvoiceForm />
    </div>
  );
}

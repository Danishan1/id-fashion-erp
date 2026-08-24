import { SalesInvoiceForm } from "./SalesInvoiceForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewSalesInvoicePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Sales Invoices", href: "/accounts/sales-invoices" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Sales Invoice</h1>
      <SalesInvoiceForm />
    </div>
  );
}

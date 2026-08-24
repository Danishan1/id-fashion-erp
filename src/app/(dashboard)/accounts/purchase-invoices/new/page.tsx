import { PurchaseInvoiceForm } from "./PurchaseInvoiceForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default function NewPurchaseInvoicePage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Accounts", href: "/accounts" },
          { label: "Purchase Invoices", href: "/accounts/purchase-invoices" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Purchase Invoice</h1>
      <PurchaseInvoiceForm />
    </div>
  );
}

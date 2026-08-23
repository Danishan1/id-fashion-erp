import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { PurchaseOrderForm } from "../PurchaseOrderForm";

export default function NewPurchaseOrderPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Purchase Orders", href: "/purchase-orders" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Purchase Order</h1>
      <PurchaseOrderForm />
    </div>
  );
}

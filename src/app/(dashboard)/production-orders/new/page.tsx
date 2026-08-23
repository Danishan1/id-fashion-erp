import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ProductionOrderForm } from "../ProductionOrderForm";

export default function NewProductionOrderPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Production Orders", href: "/production-orders" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Production Order</h1>
      <ProductionOrderForm />
    </div>
  );
}

import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { StockMovementForm } from "./StockMovementForm";

export default function NewStockMovementPage() {
  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Stock Movements", href: "/inventory/stock-movements" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Stock Movement</h1>
      <StockMovementForm />
    </div>
  );
}

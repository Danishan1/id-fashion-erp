import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SalesOrderForm } from "../SalesOrderForm";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; originatingOpportunityId?: string; originatingOpportunityNumber?: string }>;
}) {
  const { customerId, originatingOpportunityId, originatingOpportunityNumber } = await searchParams;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sales Orders", href: "/sales-orders" }, { label: "New" }]} />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Sales Order</h1>
      <SalesOrderForm presetCustomerId={customerId} originatingOpportunityId={originatingOpportunityId} originatingOpportunityNumber={originatingOpportunityNumber} />
    </div>
  );
}

import { DispatchForm, type DispatchPrefill } from "./DispatchForm";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function NewDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ salesOrderId?: string; salesOrderItemId?: string; quantity?: string }>;
}) {
  const params = await searchParams;
  const quantity = Number(params.quantity);
  const prefill: DispatchPrefill | undefined = params.salesOrderId
    ? {
        salesOrderId: params.salesOrderId,
        salesOrderItemId: params.salesOrderItemId,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
      }
    : undefined;

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Dispatch", href: "/dispatch" },
          { label: "New" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">New Dispatch</h1>
      <DispatchForm prefill={prefill} />
    </div>
  );
}

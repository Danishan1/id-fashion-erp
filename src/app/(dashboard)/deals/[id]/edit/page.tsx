import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getDealById } from "@/modules/crm/deal.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DealForm } from "../../DealForm";

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const deal = await getDealById(session!.user.companyId, id).catch(() => null);
  if (!deal) notFound();
  if (deal.stage === "WON" || deal.stage === "LOST") notFound();

  return (
    <div className="space-y-4">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Deals", href: "/deals" },
          { label: deal.dealNumber, href: `/deals/${id}` },
          { label: "Edit" },
        ]}
      />
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Edit {deal.dealNumber}</h1>
      <DealForm key={id} initialDeal={JSON.parse(JSON.stringify(deal))} />
    </div>
  );
}

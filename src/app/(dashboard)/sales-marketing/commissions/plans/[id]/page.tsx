import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PlanDetailClient } from "@/components/sales-marketing/commissions/PlanDetailClient";
import { todayIsoDate } from "@/lib/date";
import { getPlan } from "@/modules/sales-marketing/commissions/commission-plan.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CommissionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const plan = await getPlan(actor, id).catch(() => null);
  if (!plan) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${plan.code} · ${plan.name}`} breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Plans", href: "/sales-marketing/commissions/plans" }, { label: plan.code }]} />
      <PlanDetailClient key={id} initial={plan} canEdit={permissions.commissions.edit} canApprove={permissions.commissions.approve} canReject={permissions.commissions.reject} today={todayIsoDate()} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { IncentiveDetailClient } from "@/components/sales-marketing/commissions/IncentivePlansClient";
import { todayIsoDate } from "@/lib/date";
import { getIncentivePlan } from "@/modules/sales-marketing/commissions/incentive-plan.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function IncentivePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const p = await getIncentivePlan(actor, id).catch(() => null);
  if (!p) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${p.code} · ${p.name}`} breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Incentives", href: "/sales-marketing/commissions/incentives" }, { label: p.code }]} />
      <IncentiveDetailClient key={id} initial={p} canEdit={permissions.commissions.edit} canApprove={permissions.commissions.approve} canReject={permissions.commissions.reject} today={todayIsoDate()} />
    </>
  );
}

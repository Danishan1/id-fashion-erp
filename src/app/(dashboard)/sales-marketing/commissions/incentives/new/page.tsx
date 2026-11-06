import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { IncentivePlanForm } from "@/components/sales-marketing/commissions/IncentivePlansClient";
import { todayIsoDate } from "@/lib/date";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewIncentivePlanPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.commissions.edit) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New incentive plan" breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Incentives", href: "/sales-marketing/commissions/incentives" }, { label: "New" }]} />
      <IncentivePlanForm today={todayIsoDate()} />
    </>
  );
}

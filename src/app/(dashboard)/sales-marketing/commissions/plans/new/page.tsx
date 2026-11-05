import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PlanCreateForm } from "@/components/sales-marketing/commissions/PlanCreateForm";
import { todayIsoDate } from "@/lib/date";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewCommissionPlanPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.commissions.edit) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New commission plan" breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Plans", href: "/sales-marketing/commissions/plans" }, { label: "New" }]} />
      <PlanCreateForm today={todayIsoDate()} />
    </>
  );
}

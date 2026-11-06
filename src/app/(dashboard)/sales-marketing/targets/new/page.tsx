import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TargetCreateForm } from "@/components/sales-marketing/performance/TargetCreateForm";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewTargetPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.performance.create) notFound();
  const ctx = await periodContext(actor.companyId);
  return (
    <>
      <SalesMarketingPageHeader title="New sales target" breadcrumbs={[{ label: "Sales targets", href: "/sales-marketing/targets" }, { label: "New" }]} />
      <TargetCreateForm {...ctx} canSeeCompany={permissions.performance.viewAll} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ScenarioEditor } from "@/components/sales-marketing/forecast/ScenarioEditor";
import { periodContaining } from "@/modules/sales-marketing/performance/performance-periods";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewScenarioPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.performance.create) notFound();
  const ctx = await periodContext(actor.companyId);
  return (
    <>
      <SalesMarketingPageHeader title="New what-if scenario" breadcrumbs={[{ label: "Forecast", href: "/sales-marketing/forecast" }, { label: "Scenarios", href: "/sales-marketing/forecast/scenarios" }, { label: "New" }]} />
      <ScenarioEditor {...ctx} initialPeriod={{ periodType: "MONTH", periodStart: periodContaining("MONTH", ctx.today, ctx.fiscalStartMonth).start }} canSave canEdit={false} />
    </>
  );
}

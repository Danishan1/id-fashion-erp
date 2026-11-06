import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ScenarioEditor } from "@/components/sales-marketing/forecast/ScenarioEditor";
import { getScenario } from "@/modules/sales-marketing/forecast/forecast-scenario.service";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const s = await getScenario(actor, id).catch(() => null);
  if (!s) notFound();
  const ctx = await periodContext(actor.companyId);
  return (
    <>
      <SalesMarketingPageHeader title={s.name} description={s.description ?? undefined} breadcrumbs={[{ label: "Forecast", href: "/sales-marketing/forecast" }, { label: "Scenarios", href: "/sales-marketing/forecast/scenarios" }, { label: s.name }]} />
      <ScenarioEditor key={id} {...ctx} initialPeriod={{ periodType: s.periodType, periodStart: s.periodStart }} existing={JSON.parse(JSON.stringify(s))} canSave={permissions.performance.create} canEdit={permissions.performance.edit} />
    </>
  );
}

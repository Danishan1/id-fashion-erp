import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TerritoryDetailClient } from "@/components/sales-marketing/performance/TerritoryDetailClient";
import { todayIsoDate } from "@/lib/date";
import { getTerritory } from "@/modules/sales-marketing/performance/territory.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function TerritoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const t = await getTerritory(actor, id).catch(() => null);
  if (!t) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={t.name} description={`Territory ${t.code}`} breadcrumbs={[{ label: "Territories", href: "/sales-marketing/territories" }, { label: t.code }]} />
      <TerritoryDetailClient key={id} initial={JSON.parse(JSON.stringify(t))} canEdit={permissions.performance.edit} today={todayIsoDate()} />
    </>
  );
}

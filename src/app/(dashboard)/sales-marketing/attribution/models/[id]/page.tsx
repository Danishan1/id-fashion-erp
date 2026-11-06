import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { AttributionModelDetailClient } from "@/components/sales-marketing/attribution/AttributionModelDetailClient";
import { todayIsoDate } from "@/lib/date";
import { getModel } from "@/modules/sales-marketing/attribution/attribution-model.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function AttributionModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const m = await getModel(actor, id).catch(() => null);
  if (!m) notFound();
  return (
    <>
      <SalesMarketingPageHeader
        title={`${m.code} · ${m.name}`}
        breadcrumbs={[{ label: "Attribution & ROI", href: "/sales-marketing/attribution" }, { label: "Models", href: "/sales-marketing/attribution/models" }, { label: m.code }]}
      />
      <AttributionModelDetailClient key={id} initial={JSON.parse(JSON.stringify(m))} today={todayIsoDate()} />
    </>
  );
}

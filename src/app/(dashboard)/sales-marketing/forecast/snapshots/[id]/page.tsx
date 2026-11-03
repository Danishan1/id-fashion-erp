import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ForecastSnapshotDetail } from "@/components/sales-marketing/forecast/ForecastSnapshotDetail";
import { getSnapshot } from "@/modules/sales-marketing/forecast/forecast-snapshot.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function ForecastSnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const s = await getSnapshot(actor, id).catch(() => null);
  if (!s) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`Snapshot · ${s.periodLabel}`} breadcrumbs={[{ label: "Forecast", href: "/sales-marketing/forecast" }, { label: "Snapshots", href: "/sales-marketing/forecast/snapshots" }, { label: s.periodLabel }]} />
      <ForecastSnapshotDetail s={JSON.parse(JSON.stringify(s))} />
    </>
  );
}

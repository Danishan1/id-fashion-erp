import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ForecastSnapshotsClient } from "@/components/sales-marketing/forecast/ForecastSnapshotsClient";

export default function ForecastSnapshotsPage() {
  return (
    <>
      <SalesMarketingPageHeader title="Forecast snapshots & accuracy" description="Forecasts kept exactly as they were calculated, compared with what was actually booked once the period has ended." breadcrumbs={[{ label: "Forecast", href: "/sales-marketing/forecast" }, { label: "Snapshots" }]} />
      <ForecastSnapshotsClient />
    </>
  );
}

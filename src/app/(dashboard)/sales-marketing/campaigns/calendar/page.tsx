import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CampaignCalendarClient } from "@/components/sales-marketing/campaigns/CampaignCalendarClient";
import { todayIsoDate } from "@/lib/date";

export default function CampaignCalendarPage() {
  const today = todayIsoDate();
  return (
    <>
      <SalesMarketingPageHeader title="Campaign calendar" description="Planned and actual campaign dates with their milestones and activities." breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: "Calendar" }]} />
      <CampaignCalendarClient initialMonth={today.slice(0, 7)} today={today} />
    </>
  );
}

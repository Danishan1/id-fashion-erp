import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { AttributionDashboardClient } from "@/components/sales-marketing/attribution/AttributionDashboardClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { todayIsoDate } from "@/lib/date";

/** Sales & Marketing → Attribution & ROI (Phase 13). */
export default async function AttributionPage() {
  const session = await auth();
  const canRecalculate = session?.user?.id ? await PermissionService.can(session.user.id, "marketing_attribution", "edit") : false;
  return (
    <>
      <SalesMarketingPageHeader
        title="Attribution & ROI"
        description="How an approved attribution model shares credit for leads, enquiries, accepted quotations and booked orders between campaign touches, with attributed revenue against actual campaign spend. Credit is a rule, not proof that a campaign caused a sale."
        breadcrumbs={[{ label: "Attribution & ROI" }]}
      />
      <AttributionDashboardClient canRecalculate={canRecalculate} today={todayIsoDate()} />
    </>
  );
}

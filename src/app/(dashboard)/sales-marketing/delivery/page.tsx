import Link from "next/link";
import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { RunsClient } from "@/components/sales-marketing/delivery/RunsClient";
import { buttonClasses } from "@/components/ui/Button";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Sales & Marketing → Delivery Runs (Phase 10). */
export default async function DeliveryRunsPage() {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "marketing_delivery", "view"))) notFound();
  const canSettings = await PermissionService.can(session.user.id, "sales_marketing_settings", "view");
  return (
    <>
      <SalesMarketingPageHeader
        title="Delivery Runs"
        description="Campaign messages sent by email, SMS or WhatsApp. Runs are started from a campaign's Channels & delivery panel — nothing is sent automatically."
        breadcrumbs={[{ label: "Delivery Runs" }]}
        actions={
          canSettings ? (
            <Link href="/sales-marketing/delivery/connections" className={buttonClasses("secondary", "sm")}>
              Channel connections
            </Link>
          ) : null
        }
      />
      <RunsClient />
    </>
  );
}

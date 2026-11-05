import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TargetsListClient } from "@/components/sales-marketing/performance/TargetsListClient";
import { buttonClasses } from "@/components/ui/Button";
import { periodContext } from "@/modules/sales-marketing/performance/performance-page";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Sales Targets (Phase 05). */
export default async function TargetsPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  const ctx = await periodContext(actor.companyId);
  return (
    <>
      <SalesMarketingPageHeader
        title="Sales targets"
        description="Monthly, quarterly and yearly targets per rep, team, territory or company. A target counts once it is approved by someone other than whoever prepared it."
        breadcrumbs={[{ label: "Sales targets" }]}
        actions={
          permissions.performance.create ? (
            <Link href="/sales-marketing/targets/new" className={buttonClasses("primary", "sm")}>
              New target
            </Link>
          ) : undefined
        }
      />
      <TargetsListClient {...ctx} />
    </>
  );
}

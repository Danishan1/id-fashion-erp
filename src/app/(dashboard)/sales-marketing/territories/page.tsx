import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TerritoriesListClient } from "@/components/sales-marketing/performance/TerritoriesListClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Territories (Phase 05). */
export default async function TerritoriesPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Sales territories"
        description="Regions with their customers and sales reps. A new order takes its customer's territory, so territory results are never rewritten later."
        breadcrumbs={[{ label: "Territories" }]}
        actions={
          permissions.performance.edit ? (
            <Link href="/sales-marketing/territories/new" className={buttonClasses("primary", "sm")}>
              New territory
            </Link>
          ) : undefined
        }
      />
      <TerritoriesListClient />
    </>
  );
}

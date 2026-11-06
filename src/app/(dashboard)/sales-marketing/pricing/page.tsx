import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PriceListsListClient } from "@/components/sales-marketing/pricing/PriceListsListClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Price Lists (Phase 03). */
export default async function PriceListsPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Price lists"
        description="Default and customer prices per Style, with quantity breaks. A customer's own list wins over the default; changes go through approval and apply from a date."
        breadcrumbs={[{ label: "Price lists" }]}
        actions={
          permissions.pricing.create ? (
            <Link href="/sales-marketing/pricing/new" className={buttonClasses("primary", "sm")}>
              New price list
            </Link>
          ) : undefined
        }
      />
      <PriceListsListClient />
    </>
  );
}

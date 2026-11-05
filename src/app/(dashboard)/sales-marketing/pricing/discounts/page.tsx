import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { DiscountRulesListClient } from "@/components/sales-marketing/pricing/DiscountRulesClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Discount Rules (Phase 03). */
export default async function DiscountRulesPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Discount rules"
        description="Automatic line discounts on price-list prices: % or ₹ per unit, for a Style, category, customer, price list or minimum quantity. Active only after someone else approves them."
        breadcrumbs={[{ label: "Discount rules" }]}
        actions={
          permissions.pricing.create ? (
            <Link href="/sales-marketing/pricing/discounts/new" className={buttonClasses("primary", "sm")}>
              New rule
            </Link>
          ) : undefined
        }
      />
      <DiscountRulesListClient />
    </>
  );
}

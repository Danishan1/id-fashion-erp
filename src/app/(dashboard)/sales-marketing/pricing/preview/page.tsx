import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PricingPreviewClient } from "@/components/sales-marketing/pricing/PricingPreviewClient";

/** Pricing preview (Phase 03): what a Style costs for a customer, quantity and date. Saves nothing. */
export default function PricingPreviewPage() {
  return (
    <>
      <SalesMarketingPageHeader title="Pricing preview" description="See which price list and rules price a Style for a customer, quantity and date — and why. Nothing is saved." breadcrumbs={[{ label: "Pricing preview" }]} />
      <PricingPreviewClient />
    </>
  );
}

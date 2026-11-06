import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { BudgetOverviewClient } from "@/components/sales-marketing/budgets/BudgetOverviewClient";

/** Sales & Marketing → Campaign Budgets (Phase 12). Visibility as the Campaigns screens. */
export default function BudgetsPage() {
  return (
    <>
      <SalesMarketingPageHeader
        title="Campaign Budgets"
        description="Approved budget against actual spend (approved expenses and posted purchase invoices) and commitments (approved purchase orders not yet invoiced), all before GST, computed live from the Finance records linked to each campaign."
        breadcrumbs={[{ label: "Campaign Budgets" }]}
      />
      <BudgetOverviewClient />
    </>
  );
}

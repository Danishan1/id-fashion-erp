import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { CommissionPlansClient } from "@/components/sales-marketing/commissions/CommissionPlansClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CommissionPlansPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Commission plans"
        description="How commission is worked out for reps and sales agents. Versions are approved before they count; a payee is on one plan at a time."
        breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Plans" }]}
        actions={
          permissions.commissions.edit ? (
            <Link href="/sales-marketing/commissions/plans/new" className={buttonClasses("primary", "sm")}>
              New plan
            </Link>
          ) : undefined
        }
      />
      <CommissionPlansClient />
    </>
  );
}

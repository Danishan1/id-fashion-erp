import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { IncentivePlansClient } from "@/components/sales-marketing/commissions/IncentivePlansClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function IncentivePlansPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Incentive plans"
        description="Fixed rewards for reaching a share of an approved rep target, added to the statement of the month the target period ends."
        breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: "Incentives" }]}
        actions={
          permissions.commissions.edit ? (
            <Link href="/sales-marketing/commissions/incentives/new" className={buttonClasses("primary", "sm")}>
              New incentive plan
            </Link>
          ) : undefined
        }
      />
      <IncentivePlansClient />
    </>
  );
}

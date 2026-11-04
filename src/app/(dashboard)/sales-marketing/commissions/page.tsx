import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { StatementsClient } from "@/components/sales-marketing/commissions/StatementsClient";
import { buttonClasses } from "@/components/ui/Button";
import { recentMonths } from "@/modules/sales-marketing/commissions/commission-statement.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Commissions → Statements (Phase 07). */
export default async function CommissionStatementsPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Commission statements"
        description="Monthly commission and incentives per rep or sales agent: calculate → submit → approve → paid through Accounts → Payment Requests."
        breadcrumbs={[{ label: "Commission statements" }]}
        actions={
          <div className="flex gap-2">
            <Link href="/sales-marketing/commissions/plans" className={buttonClasses("secondary", "sm")}>
              Plans
            </Link>
            <Link href="/sales-marketing/commissions/incentives" className={buttonClasses("secondary", "sm")}>
              Incentives
            </Link>
          </div>
        }
      />
      <StatementsClient months={recentMonths()} canCalculate={permissions.commissions.create} viewAll={permissions.commissions.viewAll} />
    </>
  );
}

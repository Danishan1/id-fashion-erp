import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { QuotationsListClient } from "@/components/sales-marketing/quotations/QuotationsListClient";
import { buttonClasses } from "@/components/ui/Button";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Quotations (Release 1 / S2). */
export default async function QuotationsPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  const viewAll = await PermissionService.can(actor.userId, "sales_quotations", "view_all");
  return (
    <>
      <SalesMarketingPageHeader
        title="Quotations"
        description="Priced offers to customers and prospects. Start one from an enquiry to carry its lines across."
        breadcrumbs={[{ label: "Quotations" }]}
        actions={
          permissions.quotations.create ? (
            <Link href="/sales-marketing/quotations/new" className={buttonClasses("primary", "sm")}>
              New quotation
            </Link>
          ) : undefined
        }
      />
      <QuotationsListClient viewAll={viewAll} />
    </>
  );
}

import Link from "next/link";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesEnquiriesListClient } from "@/components/sales-marketing/enquiries/SalesEnquiriesListClient";
import { buttonClasses } from "@/components/ui/Button";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Sales & Marketing → Enquiries (Release 1 / S1). */
export default async function SalesEnquiriesPage() {
  const { permissions } = await getSalesMarketingPageContext();
  return (
    <>
      <SalesMarketingPageHeader
        title="Enquiries"
        description="Customer and prospect enquiries — owner, priority, follow-ups and qualification, through to quotation."
        breadcrumbs={[{ label: "Enquiries" }]}
        actions={
          permissions.create ? (
            <div className="flex gap-2">
              <Link href="/sales-marketing/enquiries/import" className={buttonClasses("secondary", "sm")}>
                Import
              </Link>
              <Link href="/sales-marketing/enquiries/new" className={buttonClasses("primary", "sm")}>
                New enquiry
              </Link>
            </div>
          ) : undefined
        }
      />
      <SalesEnquiriesListClient viewAll={permissions.viewAll} />
    </>
  );
}

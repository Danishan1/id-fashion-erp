import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { EnquiryImportClient } from "@/components/sales-marketing/bulk/EnquiryImportClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 14 — Sales & Marketing → Enquiries → Import (CSV / Excel, validation preview first). */
export default async function EnquiryImportPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <SalesMarketingPageHeader
        title="Import enquiries"
        description="Upload a CSV or Excel file: every row is checked first (nothing is created), then imported in the background. One row is one enquiry with one line."
        breadcrumbs={[{ label: "Enquiries", href: "/sales-marketing/enquiries" }, { label: "Import" }]}
      />
      <EnquiryImportClient />
    </>
  );
}

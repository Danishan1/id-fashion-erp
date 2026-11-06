import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { BuyerEnquiryForm } from "@/app/(dashboard)/buyer-enquiries/BuyerEnquiryForm";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewSalesEnquiryPage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.create) notFound();
  return (
    <>
      <SalesMarketingPageHeader
        title="New enquiry"
        description="Log who is asking and what they want. Lines can be existing styles or new asks described in words."
        breadcrumbs={[{ label: "Enquiries", href: "/sales-marketing/enquiries" }, { label: "New" }]}
      />
      <BuyerEnquiryForm mode="sales" currentUserId={actor.userId} canUseCrm={permissions.crmView} />
    </>
  );
}

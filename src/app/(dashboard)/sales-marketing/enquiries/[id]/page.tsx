import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SalesEnquiryDetailClient } from "@/components/sales-marketing/enquiries/SalesEnquiryDetailClient";
import { getSalesEnquiry } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { listQuotationsForEnquiry } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function SalesEnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const enquiry = await getSalesEnquiry(actor, id).catch(() => null);
  if (!enquiry) notFound();
  const quotations = await listQuotationsForEnquiry(actor, enquiry.id);
  const party = enquiry.customer?.name ?? enquiry.prospectName ?? "Unnamed prospect";

  return (
    <>
      <SalesMarketingPageHeader
        title={enquiry.subject ? `${enquiry.enquiryNumber} · ${enquiry.subject}` : enquiry.enquiryNumber}
        description={`${party}${enquiry.customer ? "" : " (prospect)"}${enquiry.buyer ? ` — ${enquiry.buyer.name}` : ""}`}
        breadcrumbs={[{ label: "Enquiries", href: "/sales-marketing/enquiries" }, { label: enquiry.enquiryNumber }]}
      />
      {/* JSON round-trip: Decimal/Date aren't serialisable across the RSC boundary.
          key={id}: remount on client-side navigation between enquiries. */}
      <SalesEnquiryDetailClient
        key={id}
        initialEnquiry={JSON.parse(JSON.stringify(enquiry))}
        quotations={quotations ? JSON.parse(JSON.stringify(quotations)) : null}
        permissions={permissions}
        currentUserId={actor.userId}
      />
    </>
  );
}

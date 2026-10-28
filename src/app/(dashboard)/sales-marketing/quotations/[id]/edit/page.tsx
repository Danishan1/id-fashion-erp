import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { QuotationEditor } from "@/components/sales-marketing/quotations/QuotationEditor";
import { toDraftValues } from "@/components/sales-marketing/quotations/draft-values";
import { getQuotation } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.quotations.edit) notFound();
  const q = await getQuotation(actor, id).catch(() => null);
  if (!q || q.status !== "DRAFT" || q.current.status !== "DRAFT") notFound();
  const c = q.current;
  const initial = toDraftValues({ ...c, customerId: q.customerId, buyerId: q.buyerId, prospectName: q.prospectName, crmCompanyId: q.crmCompanyId, crmContactId: q.crmContactId, ownerUserId: q.ownerUserId });
  const party = q.customer?.name ?? `${q.prospectName} (prospect)`;

  return (
    <>
      <SalesMarketingPageHeader
        title={`Edit ${q.quotationNumber}`}
        description="Draft — every amount is recalculated on save."
        breadcrumbs={[
          { label: "Quotations", href: "/sales-marketing/quotations" },
          { label: q.quotationNumber, href: `/sales-marketing/quotations/${q.id}` },
          { label: "Edit" },
        ]}
      />
      <QuotationEditor
        key={`${q.id}-${c.version}`}
        mode="edit"
        quotationId={q.id}
        quotationNumber={q.quotationNumber}
        version={c.version}
        enquiry={q.buyerEnquiry ? { id: q.buyerEnquiry.id, enquiryNumber: q.buyerEnquiry.enquiryNumber, partyLabel: party } : null}
        initial={initial}
        canUseCrm={permissions.crmView}
      />
    </>
  );
}

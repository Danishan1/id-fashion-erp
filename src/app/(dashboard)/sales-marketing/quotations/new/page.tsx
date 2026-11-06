import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { QuotationEditor } from "@/components/sales-marketing/quotations/QuotationEditor";
import { emptyLine, toDraftValues } from "@/components/sales-marketing/quotations/draft-values";
import { ErrorState } from "@/components/ui/PageStates";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { toIsoDate, todayIsoDate } from "@/lib/date";
import { getQuotationPrefillFromEnquiry } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesMarketingSettings } from "@/modules/sales-marketing/settings/sales-marketing-settings.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** New quotation — standalone, or ?enquiryId= to start from an enquiry. */
export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<{ enquiryId?: string }> }) {
  const { enquiryId } = await searchParams;
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.quotations.create) notFound();
  const crumbs = [{ label: "Quotations", href: "/sales-marketing/quotations" }, { label: "New" }];

  if (enquiryId) {
    let prefill: Awaited<ReturnType<typeof getQuotationPrefillFromEnquiry>>;
    try {
      prefill = await getQuotationPrefillFromEnquiry(actor, enquiryId);
    } catch (error) {
      if (error instanceof BusinessRuleError && error.code !== "NOT_FOUND") {
        return (
          <>
            <SalesMarketingPageHeader title="New quotation" breadcrumbs={crumbs} />
            <ErrorState message={error.message} />
          </>
        );
      }
      notFound();
    }
    return (
      <>
        <SalesMarketingPageHeader title="New quotation" description={`From enquiry ${prefill.enquiryNumber}. Check prices, GST and terms, then save the draft.`} breadcrumbs={crumbs} />
        <QuotationEditor
          mode="create"
          enquiry={{ id: prefill.buyerEnquiryId, enquiryNumber: prefill.enquiryNumber, partyLabel: prefill.customerName ?? `${prefill.prospectName} (prospect)` }}
          initial={toDraftValues(prefill)}
          canUseCrm={permissions.crmView}
        />
      </>
    );
  }

  const settings = await getSalesMarketingSettings(actor.companyId);
  const today = todayIsoDate();
  const t = new Date(today);
  const initial = toDraftValues({
    ownerUserId: actor.userId,
    quotationDate: today,
    validUntil: toIsoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() + settings.quotationDefaultValidityDays)),
    termsAndConditions: settings.quotationDefaultTerms,
    lines: [],
  });
  initial.lines = [emptyLine()];
  return (
    <>
      <SalesMarketingPageHeader title="New quotation" description="A quotation without an enquiry. To carry an enquiry's lines across, start it from the enquiry instead." breadcrumbs={crumbs} />
      <QuotationEditor mode="create" initial={initial} canUseCrm={permissions.crmView} />
    </>
  );
}

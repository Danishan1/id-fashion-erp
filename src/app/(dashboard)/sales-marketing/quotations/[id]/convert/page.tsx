import Link from "next/link";
import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { FinishConversionButton } from "@/components/sales-marketing/quotations/FinishConversionButton";
import { SalesOrderForm, type QuotationConversion } from "@/app/(dashboard)/sales-orders/SalesOrderForm";
import { getConversionPlan } from "@/modules/sales-marketing/quotations/quotation-conversion.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

const NOTE = "rounded-md border px-3 py-2 text-sm";

/** Accepted quotation → Sales Order (S4): the normal Sales Order form, pre-filled and locked to the accepted revision. */
export default async function ConvertQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const plan = await getConversionPlan(actor, id).catch(() => null);
  if (!plan) notFound();
  const back = `/sales-marketing/quotations/${plan.quotationId}`;
  const header = (
    <SalesMarketingPageHeader
      title={`Convert ${plan.quotationNumber} to a Sales Order`}
      description={`Revision ${plan.revisionNumber}`}
      breadcrumbs={[{ label: "Quotations", href: "/sales-marketing/quotations" }, { label: plan.quotationNumber, href: back }, { label: "Convert" }]}
    />
  );

  if (!permissions.quotations.edit || !permissions.salesOrders.create) {
    return (
      <>
        {header}
        <p className={`${NOTE} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100`}>
          Converting needs permission to edit quotations and to create sales orders.
        </p>
      </>
    );
  }

  if (plan.existingOrder) {
    return (
      <>
        {header}
        <div className={`${NOTE} space-y-2 border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-100`}>
          <p>
            Sales Order{" "}
            <Link href={`/sales-orders/${plan.existingOrder.id}`} className="font-medium underline">
              {plan.existingOrder.orderNumber}
            </Link>{" "}
            was already created from this quotation.
          </p>
          {plan.status === "ACCEPTED" && <FinishConversionButton quotationId={plan.quotationId} />}
        </div>
      </>
    );
  }

  if (plan.blockers.length > 0) {
    return (
      <>
        {header}
        <div className={`${NOTE} space-y-2 border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100`}>
          <p className="font-medium">This quotation can&apos;t be converted yet:</p>
          <ul className="list-disc space-y-1 pl-5">
            {plan.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <Link href={back} className="inline-block font-medium underline">
            Back to the quotation
          </Link>
        </div>
      </>
    );
  }

  const fromQuotation: QuotationConversion = {
    quotationId: plan.quotationId,
    quotationNumber: plan.quotationNumber,
    revisionNumber: plan.revisionNumber,
    customerId: plan.customerId!,
    buyerId: plan.buyerId,
    customerPoNumber: plan.customerPoNumber,
    requiredShipDate: plan.requiredShipDate,
    chargesNotCarried: plan.chargesNotCarried,
    // No blockers ⇒ every line has whole pieces and a price.
    lines: plan.lines.map((l) => ({
      quotationLineId: l.quotationLineId,
      lineNumber: l.lineNumber,
      description: l.description,
      colorSizeRemarks: l.colorSizeRemarks,
      productId: l.productId,
      styleFixed: l.styleFixed,
      sampleRequestId: l.sampleRequestId,
      pieces: l.pieces!,
      unitPrice: l.unitPrice!,
    })),
  };
  return (
    <>
      {header}
      <SalesOrderForm key={plan.revisionId} fromQuotation={fromQuotation} />
    </>
  );
}

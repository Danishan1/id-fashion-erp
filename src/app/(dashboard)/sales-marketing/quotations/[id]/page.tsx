import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { QuotationDetailClient } from "@/components/sales-marketing/quotations/QuotationDetailClient";
import { getQuotation } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const q = await getQuotation(actor, id).catch(() => null);
  if (!q) notFound();
  const party = q.customer?.name ?? q.prospectName ?? "—";
  return (
    <>
      <SalesMarketingPageHeader
        title={`${q.quotationNumber} · ${q.current.title}`}
        description={`${party}${q.customer ? "" : " (prospect)"}${q.buyer ? ` — ${q.buyer.name}` : ""}`}
        breadcrumbs={[{ label: "Quotations", href: "/sales-marketing/quotations" }, { label: q.quotationNumber }]}
      />
      {/* JSON round-trip: Decimal/Date aren't serialisable across the RSC boundary. key={id}: remount between quotations. */}
      <QuotationDetailClient key={id} initialQuotation={JSON.parse(JSON.stringify(q))} permissions={permissions} />
    </>
  );
}

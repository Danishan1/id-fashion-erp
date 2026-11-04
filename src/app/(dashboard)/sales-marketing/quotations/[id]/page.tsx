import { notFound } from "next/navigation";
import { ChannelAgentPanel } from "@/components/sales-marketing/channels/ChannelAgentPanel";
import { CampaignLinkPanel } from "@/components/sales-marketing/campaigns/CampaignLinkPanel";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { QuotationDetailClient } from "@/components/sales-marketing/quotations/QuotationDetailClient";
import { getQuotation } from "@/modules/sales-marketing/quotations/quotation.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Quotation detail; `?revision=n` shows an earlier revision read-only. */
export default async function QuotationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> }) {
  const { id } = await params;
  const { revision } = await searchParams;
  const n = Number(revision);
  const { actor, permissions } = await getSalesMarketingPageContext();
  const q = await getQuotation(actor, id, Number.isInteger(n) && n > 0 ? n : undefined).catch(() => null);
  if (!q) notFound();
  const party = q.customer?.name ?? q.prospectName ?? "—";
  return (
    <>
      <SalesMarketingPageHeader
        title={`${q.quotationNumber} · ${q.current.title}`}
        description={`${party}${q.customer ? "" : " (prospect)"}${q.buyer ? ` — ${q.buyer.name}` : ""}`}
        breadcrumbs={[{ label: "Quotations", href: "/sales-marketing/quotations" }, { label: q.quotationNumber }]}
      />
      <div className="mb-4">
        <ChannelAgentPanel key={`channel-${q.id}`} apiUrl={`/api/v1/sales-marketing/quotations/${q.id}/channel`} docType="QUOTATION" canChange={permissions.quotations.edit} />
      </div>
      <div className="mb-4">
        <CampaignLinkPanel key={`campaign-${q.id}`} docType="quotation" id={q.id} canChange={permissions.quotations.edit} />
      </div>
      {/* JSON round-trip: Decimal/Date aren't serialisable across the RSC boundary. key: remount between quotations/revisions. */}
      <QuotationDetailClient key={`${id}-${q.current.revisionNumber}`} initialQuotation={JSON.parse(JSON.stringify(q))} permissions={permissions} />
    </>
  );
}

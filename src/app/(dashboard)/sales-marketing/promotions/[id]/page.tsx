import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PromotionDetailClient } from "@/components/sales-marketing/promotions/PromotionDetailClient";
import { getPromotion } from "@/modules/sales-marketing/promotions/promotion.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function PromotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const p = await getPromotion(actor, id).catch(() => null);
  if (!p) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${p.code} · ${p.name}`} breadcrumbs={[{ label: "Promotions", href: "/sales-marketing/promotions" }, { label: p.code }]} />
      <PromotionDetailClient key={id} initial={JSON.parse(JSON.stringify(p))} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PriceListDetailClient } from "@/components/sales-marketing/pricing/PriceListDetailClient";
import { getPriceList } from "@/modules/sales-marketing/pricing/price-list.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Price list detail; `?version=n` opens that version. */
export default async function PriceListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const { version } = await searchParams;
  const n = Number(version);
  const { actor, permissions } = await getSalesMarketingPageContext();
  const list = await getPriceList(actor, id, Number.isInteger(n) && n > 0 ? n : undefined).catch(() => null);
  if (!list) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${list.code} · ${list.name}`} description={list.kindLabel === "Customer" ? `Customer price list — ${list.customer?.name}` : "Default price list"} breadcrumbs={[{ label: "Price lists", href: "/sales-marketing/pricing" }, { label: list.code }]} />
      {/* JSON round-trip: Decimal/Date aren't serialisable across the RSC boundary. key: remount per list/version. */}
      <PriceListDetailClient key={`${id}-${list.selected?.id ?? "none"}-${list.selected?.version ?? 0}`} initial={JSON.parse(JSON.stringify(list))} perms={{ edit: permissions.pricing.edit, approve: permissions.pricing.approve, reject: permissions.pricing.reject }} />
    </>
  );
}

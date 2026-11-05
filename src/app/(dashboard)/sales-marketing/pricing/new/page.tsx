import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { PriceListCreateForm } from "@/components/sales-marketing/pricing/PriceListCreateForm";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewPriceListPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.pricing.create) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New price list" breadcrumbs={[{ label: "Price lists", href: "/sales-marketing/pricing" }, { label: "New" }]} />
      <PriceListCreateForm />
    </>
  );
}

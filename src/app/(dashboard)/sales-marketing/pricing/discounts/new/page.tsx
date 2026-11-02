import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { DiscountRuleForm } from "@/components/sales-marketing/pricing/DiscountRulesClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { priceListOptions } from "../price-list-options";

export default async function NewDiscountRulePage() {
  const { actor, permissions } = await getSalesMarketingPageContext();
  if (!permissions.pricing.create) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New discount rule" breadcrumbs={[{ label: "Discount rules", href: "/sales-marketing/pricing/discounts" }, { label: "New" }]} />
      <DiscountRuleForm priceLists={await priceListOptions(actor.companyId)} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { DiscountRuleDetailClient } from "@/components/sales-marketing/pricing/DiscountRulesClient";
import { getDiscountRule } from "@/modules/sales-marketing/pricing/discount-rule.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { priceListOptions } from "../price-list-options";

export default async function DiscountRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const rule = await getDiscountRule(actor, id).catch(() => null);
  if (!rule) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${rule.code} · ${rule.name}`} breadcrumbs={[{ label: "Discount rules", href: "/sales-marketing/pricing/discounts" }, { label: rule.code }]} />
      <DiscountRuleDetailClient key={id} initial={JSON.parse(JSON.stringify(rule))} priceLists={await priceListOptions(actor.companyId)} perms={{ edit: permissions.pricing.edit, approve: permissions.pricing.approve, reject: permissions.pricing.reject }} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TerritoryCreateForm } from "@/components/sales-marketing/performance/TerritoryCreateForm";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function NewTerritoryPage() {
  const { permissions } = await getSalesMarketingPageContext();
  if (!permissions.performance.edit) notFound();
  return (
    <>
      <SalesMarketingPageHeader title="New territory" breadcrumbs={[{ label: "Territories", href: "/sales-marketing/territories" }, { label: "New" }]} />
      <TerritoryCreateForm />
    </>
  );
}

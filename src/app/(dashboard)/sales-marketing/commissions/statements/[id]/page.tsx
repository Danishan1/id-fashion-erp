import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { StatementDetailClient } from "@/components/sales-marketing/commissions/StatementDetailClient";
import { getStatement } from "@/modules/sales-marketing/commissions/commission-statement.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function CommissionStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const s = await getStatement(actor, id).catch(() => null);
  if (!s) notFound();
  const month = new Date(`${s.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <SalesMarketingPageHeader title={`${s.payee} · ${month}`} description="Commission statement" breadcrumbs={[{ label: "Commission statements", href: "/sales-marketing/commissions" }, { label: `${s.payee} · ${s.month}` }]} />
      <StatementDetailClient key={id} initial={JSON.parse(JSON.stringify(s))} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TargetDetailClient } from "@/components/sales-marketing/performance/TargetDetailClient";
import { getTarget } from "@/modules/sales-marketing/performance/target.service";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

export default async function TargetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, permissions } = await getSalesMarketingPageContext();
  const t = await getTarget(actor, id).catch(() => null);
  if (!t) notFound();
  return (
    <>
      <SalesMarketingPageHeader title={`${t.subject} · ${t.metricLabel}`} description={`${t.scopeLabel} target for ${t.periodLabel}`} breadcrumbs={[{ label: "Sales targets", href: "/sales-marketing/targets" }, { label: t.periodLabel }]} />
      <TargetDetailClient key={id} initial={JSON.parse(JSON.stringify(t))} perms={{ edit: permissions.performance.edit, approve: permissions.performance.approve, reject: permissions.performance.reject }} />
    </>
  );
}

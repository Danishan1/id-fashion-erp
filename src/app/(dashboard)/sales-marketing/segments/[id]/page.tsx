import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SegmentDetailClient } from "@/components/sales-marketing/segments/SegmentDetailClient";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";
import { getSegment } from "@/modules/sales-marketing/segments/segment.service";

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSalesMarketingPageContext();
  const s = await getSegment(actor, id).catch(() => null);
  if (!s) notFound();
  const [edit, archive, create] = await Promise.all((["edit", "delete", "create"] as const).map((a) => PermissionService.can(actor.userId, "marketing_segments", a)));
  return (
    <>
      <SalesMarketingPageHeader title={`${s.code} · ${s.name}`} breadcrumbs={[{ label: "Audience Segments", href: "/sales-marketing/segments" }, { label: s.code }]} />
      <SegmentDetailClient key={id} initial={JSON.parse(JSON.stringify(s))} permissions={{ edit, archive, create }} />
    </>
  );
}

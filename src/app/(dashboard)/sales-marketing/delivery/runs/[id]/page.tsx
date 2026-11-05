import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { RunDetailClient } from "@/components/sales-marketing/delivery/RunDetailClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getRun } from "@/modules/sales-marketing/delivery/delivery-run.service";

export default async function DeliveryRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null };
  const run = await getRun(actor, id).catch(() => null);
  if (!run) notFound();
  const [canCancel, canEdit] = await Promise.all([PermissionService.can(session.user.id, "marketing_delivery", "cancel"), PermissionService.can(session.user.id, "marketing_delivery", "edit")]);
  return (
    <>
      <SalesMarketingPageHeader title={`${run.campaign.code} · run #${run.runNumber}`} breadcrumbs={[{ label: "Delivery Runs", href: "/sales-marketing/delivery" }, { label: `${run.campaign.code} #${run.runNumber}` }]} />
      <RunDetailClient key={id} runId={id} canCancel={canCancel} canEdit={canEdit} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ContentEditorClient } from "@/components/sales-marketing/content/ContentEditorClient";
import { auth } from "@/core/auth/auth";
import { getCampaignContent } from "@/modules/sales-marketing/content/campaign-content.service";
import { contentPermissions } from "../../content-permissions";

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const c = await getCampaignContent({ companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null }, id).catch(() => null);
  if (!c) notFound();
  const p = await contentPermissions();
  return (
    <>
      <SalesMarketingPageHeader title={c.name} breadcrumbs={[{ label: "Campaigns", href: "/sales-marketing/campaigns" }, { label: c.campaign.code, href: `/sales-marketing/campaigns/${c.campaign.id}` }, { label: c.name }]} />
      <ContentEditorClient key={id} contentId={id} canEdit={p.edit} canArchive={p.archive} canApprove={p.approve} canReject={p.reject} canPreviewContact={p.crmView} />
    </>
  );
}

import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { TemplateReviewClient } from "@/components/sales-marketing/content/TemplateReviewClient";
import { auth } from "@/core/auth/auth";
import { getMarketingTemplate } from "@/modules/sales-marketing/content/marketing-template.service";
import { contentPermissions } from "../../content-permissions";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const t = await getMarketingTemplate({ companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null }, id).catch(() => null);
  if (!t) notFound();
  const p = await contentPermissions();
  return (
    <>
      <SalesMarketingPageHeader title={t.name} breadcrumbs={[{ label: "Content Library", href: "/sales-marketing/content?tab=templates" }, { label: t.name }]} />
      <TemplateReviewClient key={id} templateId={id} canEdit={p.edit} canApprove={p.approve} canReject={p.reject} canOpenCrm={p.crmView} />
    </>
  );
}

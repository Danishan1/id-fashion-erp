import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { AssetDetailClient } from "@/components/sales-marketing/content/AssetDetailClient";
import { auth } from "@/core/auth/auth";
import { getAsset } from "@/modules/sales-marketing/content/asset.service";
import { contentPermissions } from "../../content-permissions";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) notFound();
  const a = await getAsset({ companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId ?? null }, id).catch(() => null);
  if (!a) notFound();
  const p = await contentPermissions();
  return (
    <>
      <SalesMarketingPageHeader title={`${a.code} · ${a.name}`} breadcrumbs={[{ label: "Content Library", href: "/sales-marketing/content" }, { label: a.code }]} />
      <AssetDetailClient key={id} assetId={id} canEdit={p.edit} canArchive={p.archive} canApprove={p.approve} canReject={p.reject} />
    </>
  );
}

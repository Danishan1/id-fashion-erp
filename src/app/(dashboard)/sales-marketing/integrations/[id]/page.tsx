import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmIntegrationDetailClient } from "@/components/sales-marketing/integrations/SmIntegrationDetailClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

/** Phase 16 — one integration. */
export default async function SmIntegrationPage({ params }: { params: Promise<{ id: string }> }) {
  await getSalesMarketingPageContext();
  const session = await auth();
  const canEdit = await PermissionService.can(session!.user!.id!, "sales_integrations", "edit");
  const { id } = await params;
  return (
    <>
      <SalesMarketingPageHeader title="Integration" breadcrumbs={[{ label: "Integrations", href: "/sales-marketing/integrations" }, { label: "Integration" }]} />
      <SmIntegrationDetailClient key={id} id={id} canEdit={canEdit} />
    </>
  );
}

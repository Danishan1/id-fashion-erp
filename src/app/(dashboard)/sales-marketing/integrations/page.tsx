import { headers } from "next/headers";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { SmIntegrationsClient, type IntegrationsTab } from "@/components/sales-marketing/integrations/SmIntegrationsClient";
import { getSalesMarketingPageContext } from "@/modules/sales-marketing/sales-marketing-page";

const TABS: IntegrationsTab[] = ["registry", "keys", "webhooks", "conflicts", "guide"];

/** Phase 16 — Sales & Marketing → Integrations: registry, API keys, outgoing webhooks, sync conflicts and the developer guide. */
export default async function SmIntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await getSalesMarketingPageContext();
  const session = await auth();
  const userId = session!.user!.id!;
  const [canEdit, canApprove] = await Promise.all([PermissionService.can(userId, "sales_integrations", "edit"), PermissionService.can(userId, "sales_integrations", "approve")]);
  const { tab } = await searchParams;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "your-erp.example.com"}`;
  return (
    <>
      <SalesMarketingPageHeader
        title="Integrations"
        description="Connect other systems to Sales & Marketing: scoped API keys, signed outgoing webhooks for S&M events, enquiry intake with conflict review, and the health of every connection — including the marketing delivery providers."
        breadcrumbs={[{ label: "Integrations" }]}
      />
      <SmIntegrationsClient initialTab={TABS.includes(tab as IntegrationsTab) ? (tab as IntegrationsTab) : "registry"} canEdit={canEdit} canApprove={canApprove} origin={origin} />
    </>
  );
}

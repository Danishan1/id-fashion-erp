import { notFound } from "next/navigation";
import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ConnectionsClient } from "@/components/sales-marketing/delivery/ConnectionsClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

/** Sales & Marketing → Channel Connections (Phase 10). Settings users only. */
export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user?.id || !(await PermissionService.can(session.user.id, "sales_marketing_settings", "view"))) notFound();
  const canEdit = await PermissionService.can(session.user.id, "sales_marketing_settings", "edit");
  return (
    <>
      <SalesMarketingPageHeader
        title="Channel Connections"
        description="Email (SMTP, Brevo), SMS (MSG91) and WhatsApp Cloud API accounts used to send campaign messages."
        breadcrumbs={[{ label: "Delivery Runs", href: "/sales-marketing/delivery" }, { label: "Channel Connections" }]}
      />
      <ConnectionsClient canEdit={canEdit} />
    </>
  );
}

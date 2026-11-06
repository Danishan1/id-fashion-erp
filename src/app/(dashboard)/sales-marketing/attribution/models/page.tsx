import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { AttributionModelsClient } from "@/components/sales-marketing/attribution/AttributionModelsClient";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";

export default async function AttributionModelsPage() {
  const session = await auth();
  const canCreate = session?.user?.id ? await PermissionService.can(session.user.id, "marketing_attribution", "create") : false;
  return (
    <>
      <SalesMarketingPageHeader
        title="Attribution models"
        description="Rules for sharing credit between campaign touches. Each version is approved by someone other than its author; results always keep the version they were calculated with."
        breadcrumbs={[{ label: "Attribution & ROI", href: "/sales-marketing/attribution" }, { label: "Models" }]}
      />
      <AttributionModelsClient canCreate={canCreate} />
    </>
  );
}

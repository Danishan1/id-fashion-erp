import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { TemplatesListClient } from "./_components/TemplatesListClient";

/** Phase 12 — reusable message templates (email, SMS, WhatsApp) for the Inbox and, later, sequences and workflows. */
export default async function CrmTemplatesPage() {
  const { permissions } = await getCrmPageContext();
  return (
    <>
      <CrmPageHeader title="Message templates" description="Reusable email, SMS and WhatsApp messages with merge fields. Only active templates are offered when sending." breadcrumbs={[{ label: "Templates" }]} />
      <TemplatesListClient permissions={permissions} />
    </>
  );
}

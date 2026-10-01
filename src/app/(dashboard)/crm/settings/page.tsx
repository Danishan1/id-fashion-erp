import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CrmSettingsClient, type CrmSettingsTab } from "./_components/CrmSettingsClient";

const TABS: CrmSettingsTab[] = ["statuses", "sources", "tags", "custom-fields", "duplicates", "api-keys", "webhooks"];

/** CRM configuration — requires crm_settings.view; changes require crm_settings.edit. */
export default async function CrmSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  const { tab } = await searchParams;
  const initialTab = TABS.includes(tab as CrmSettingsTab) ? (tab as CrmSettingsTab) : "statuses";
  return (
    <>
      <CrmPageHeader
        title="CRM Settings"
        description={permissions.settingsEdit ? "Lead statuses, sources, tags, custom fields, duplicate rules, API keys and webhooks for this company." : "You can view these settings. Ask an admin to change them."}

        breadcrumbs={[{ label: "Settings" }]}
      />
      <CrmSettingsClient initialTab={initialTab} canEdit={permissions.settingsEdit} />
    </>
  );
}

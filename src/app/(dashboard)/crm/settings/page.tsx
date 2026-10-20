import { notFound } from "next/navigation";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { getCrmPageContext } from "@/modules/crm/core/crm-page";
import { CrmSettingsClient } from "./_components/CrmSettingsClient";
import { CRM_SETTINGS_TABS, type CrmSettingsTab } from "./_components/settings-tabs";

/** CRM configuration — requires crm_settings.view; changes require crm_settings.edit. */
export default async function CrmSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { permissions } = await getCrmPageContext();
  if (!permissions.settings) notFound();
  const { tab } = await searchParams;
  const initialTab = (CRM_SETTINGS_TABS as readonly string[]).includes(tab ?? "") ? (tab as CrmSettingsTab) : "overview";
  return (
    <>
      <CrmPageHeader
        title="CRM Settings"
        description={permissions.settingsEdit ? "Configure the CRM, connect other systems and manage API access and webhooks for this company." : "You can view these settings. Ask an admin to change them."}
        breadcrumbs={[{ label: "Settings" }]}
      />
      <CrmSettingsClient initialTab={initialTab} canEdit={permissions.settingsEdit} permissions={permissions} />
    </>
  );
}

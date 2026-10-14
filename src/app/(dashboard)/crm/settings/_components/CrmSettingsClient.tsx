"use client";

import { useState } from "react";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";
import { ApiAccessTab } from "./ApiAccessTab";
import { ApiKeysTab } from "./ApiKeysTab";
import { AutomationTab } from "./AutomationTab";
import { ChannelsTab } from "./ChannelsTab";
import { CompanyDuplicateRulesTab } from "./CompanyDuplicateRulesTab";
import { CompanyStatusesTab } from "./CompanyStatusesTab";
import { ContactDuplicateRulesTab } from "./ContactDuplicateRulesTab";
import { CustomFieldsTab } from "./CustomFieldsTab";
import { DuplicateRulesTab } from "./DuplicateRulesTab";
import { LeadSourcesTab } from "./LeadSourcesTab";
import { LeadStatusesTab } from "./LeadStatusesTab";
import { OptionValuesTab } from "./OptionValuesTab";
import { OutgoingWebhooksTab } from "./OutgoingWebhooksTab";
import { AccessTab, IntegrationsTab, OverviewTab } from "./OverviewTabs";
import { PipelinesTab } from "./PipelinesTab";
import { TagsTab } from "./TagsTab";
import { WebhooksTab } from "./WebhooksTab";
import { SETTINGS_GROUPS, type CrmSettingsTab } from "./settings-tabs";

export type { CrmSettingsTab } from "./settings-tabs";

const LABELS = new Map(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label] as const)));

export function CrmSettingsClient({ initialTab, canEdit, permissions }: { initialTab: CrmSettingsTab; canEdit: boolean; permissions: CrmPagePermissions }) {
  const [tab, setTab] = useState(initialTab);

  const select = (id: CrmSettingsTab) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Small screens: one select. Large screens: grouped side navigation. */}
      <div className="lg:hidden">
        <label htmlFor="crm-settings-section" className="sr-only">
          Settings section
        </label>
        <select id="crm-settings-section" className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={tab} onChange={(e) => select(e.target.value as CrmSettingsTab)}>
          {SETTINGS_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <nav aria-label="CRM settings" className="hidden w-56 shrink-0 space-y-4 lg:block">
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    id={`crm-settings-tab-${i.id}`}
                    aria-current={tab === i.id ? "page" : undefined}
                    onClick={() => select(i.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                      tab === i.id ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {i.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <section id="crm-settings-panel" aria-label={LABELS.get(tab)} className="min-w-0 flex-1 space-y-4">
        <h2 className="text-lg font-semibold">{LABELS.get(tab)}</h2>
        {tab === "overview" && <OverviewTab onSelect={select} />}
        {tab === "access" && <AccessTab permissions={permissions} />}
        {tab === "statuses" && <LeadStatusesTab canEdit={canEdit} />}
        {tab === "sources" && <LeadSourcesTab canEdit={canEdit} />}
        {tab === "tags" && <TagsTab canEdit={canEdit} />}
        {tab === "custom-fields" && <CustomFieldsTab key="LEAD" canEdit={canEdit} entityType="LEAD" />}
        {tab === "duplicates" && <DuplicateRulesTab canEdit={canEdit} />}
        {tab === "contact-fields" && <CustomFieldsTab key="CONTACT" canEdit={canEdit} entityType="CONTACT" />}
        {tab === "contact-duplicates" && <ContactDuplicateRulesTab canEdit={canEdit} />}
        {tab === "company-statuses" && <CompanyStatusesTab canEdit={canEdit} />}
        {tab === "company-fields" && <CustomFieldsTab key="COMPANY" canEdit={canEdit} entityType="COMPANY" />}
        {tab === "company-duplicates" && <CompanyDuplicateRulesTab canEdit={canEdit} />}
        {tab === "pipelines" && <PipelinesTab canEdit={canEdit} />}
        {tab === "opportunity-fields" && <CustomFieldsTab key="OPPORTUNITY" canEdit={canEdit} entityType="OPPORTUNITY" />}
        {tab === "contact-options" && <OptionValuesTab canEdit={canEdit} />}
        {tab === "integrations" && <IntegrationsTab onSelect={select} />}
        {tab === "api" && <ApiAccessTab onSelect={select} />}
        {tab === "api-keys" && <ApiKeysTab canEdit={canEdit} />}
        {tab === "webhooks" && <WebhooksTab canEdit={canEdit} />}
        {tab === "webhooks-out" && <OutgoingWebhooksTab canEdit={canEdit} />}
        {tab === "channels" && <ChannelsTab canEdit={canEdit} />}
        {tab === "automation" && <AutomationTab onSelect={select} />}
      </section>
    </div>
  );
}

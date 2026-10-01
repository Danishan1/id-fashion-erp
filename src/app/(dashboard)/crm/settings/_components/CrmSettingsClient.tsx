"use client";

import { useState } from "react";
import { ApiKeysTab } from "./ApiKeysTab";
import { CustomFieldsTab } from "./CustomFieldsTab";
import { DuplicateRulesTab } from "./DuplicateRulesTab";
import { LeadSourcesTab } from "./LeadSourcesTab";
import { LeadStatusesTab } from "./LeadStatusesTab";
import { TagsTab } from "./TagsTab";
import { WebhooksTab } from "./WebhooksTab";

export type CrmSettingsTab = "statuses" | "sources" | "tags" | "custom-fields" | "duplicates" | "api-keys" | "webhooks";

const TABS: { id: CrmSettingsTab; label: string }[] = [
  { id: "statuses", label: "Lead statuses" },
  { id: "sources", label: "Lead sources" },
  { id: "tags", label: "Tags" },
  { id: "custom-fields", label: "Lead custom fields" },
  { id: "duplicates", label: "Duplicate rules" },
  { id: "api-keys", label: "API keys" },
  { id: "webhooks", label: "Webhooks" },
];

export function CrmSettingsClient({ initialTab, canEdit }: { initialTab: CrmSettingsTab; canEdit: boolean }) {
  const [tab, setTab] = useState(initialTab);

  const select = (id: CrmSettingsTab) => {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="CRM settings" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`crm-settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="crm-settings-panel"
            onClick={() => select(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="crm-settings-panel" aria-labelledby={`crm-settings-tab-${tab}`}>
        {tab === "statuses" && <LeadStatusesTab canEdit={canEdit} />}
        {tab === "sources" && <LeadSourcesTab canEdit={canEdit} />}
        {tab === "tags" && <TagsTab canEdit={canEdit} />}
        {tab === "custom-fields" && <CustomFieldsTab canEdit={canEdit} />}
        {tab === "duplicates" && <DuplicateRulesTab canEdit={canEdit} />}
        {tab === "api-keys" && <ApiKeysTab canEdit={canEdit} />}
        {tab === "webhooks" && <WebhooksTab canEdit={canEdit} />}

      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { CRM_OPTION_LIST_KEYS, CRM_OPTION_LISTS, type CrmOptionListKey } from "@/modules/crm/contacts/contact-registry";
import { useSettingsList } from "./useSettingsList";

interface OptionRow {
  id: string;
  listKey: CrmOptionListKey;
  value: string;
  sortOrder: number;
  isActive: boolean;
}

const URL_BASE = "/api/v1/crm/settings/option-values";

/** Department / designation / relationship-role suggestions shown on the contact form (free text is still allowed). */
export function OptionValuesTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<OptionRow>(URL_BASE);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;

  const add = async (listKey: CrmOptionListKey) => {
    const value = (drafts[listKey] ?? "").trim();
    if (!value) return;
    setBusy(listKey);
    const res = await crmRequest(URL_BASE, { method: "POST", body: { listKey, value }, successMessage: "Added." });
    setBusy(null);
    if (res.ok) {
      setDrafts((d) => ({ ...d, [listKey]: "" }));
      reload();
    }
  };
  const toggle = async (row: OptionRow) => {
    setBusy(row.id);
    const res = await crmRequest(`${URL_BASE}/${row.id}`, { method: "PATCH", body: { isActive: !row.isActive }, successMessage: row.isActive ? "Hidden from suggestions." : "Shown in suggestions." });
    setBusy(null);
    if (res.ok) reload();
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Suggestions on the contact, company and opportunity forms. People can still type their own value; turning a suggestion off never changes records that already use it.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        {CRM_OPTION_LIST_KEYS.map((listKey) => (
          <section key={listKey} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{CRM_OPTION_LISTS[listKey].label}</h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{CRM_OPTION_LISTS[listKey].help}</p>
            </div>
            <ul className="space-y-1.5">
              {rows
                .filter((r) => r.listKey === listKey)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className={r.isActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}>{r.value}</span>
                    {canEdit && <ToggleSwitch checked={r.isActive} onToggle={() => toggle(r)} disabled={busy === r.id} label={`${r.isActive ? "Hide" : "Show"} ${r.value}`} />}
                  </li>
                ))}
            </ul>
            {canEdit && (
              <div className="flex gap-2">
                <label htmlFor={`opt-${listKey}`} className="sr-only">
                  New value
                </label>
                <input
                  id={`opt-${listKey}`}
                  className={textInputClass()}
                  placeholder="Add…"
                  maxLength={100}
                  value={drafts[listKey] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [listKey]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void add(listKey);
                    }
                  }}
                />
                <Button variant="secondary" onClick={() => add(listKey)} disabled={!(drafts[listKey] ?? "").trim()} isLoading={busy === listKey}>
                  Add
                </Button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

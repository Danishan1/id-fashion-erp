"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { CONTACT_DUPLICATE_RULE_LABELS, type ContactDuplicateAction, type ContactDuplicateRule } from "@/modules/crm/contacts/contact-registry";
import { useSettingsList } from "./useSettingsList";

const ACTIONS: { value: ContactDuplicateAction; label: string; help: string }[] = [
  { value: "WARN", label: "Warn", help: "Show the matches and let the user save anyway." },
  { value: "BLOCK", label: "Block", help: "Don't allow saving — open or merge the existing contact instead." },
  { value: "FLAG", label: "Flag", help: "Save, and mark the new contact as a possible duplicate for review." },
  { value: "OFF", label: "Allow", help: "Don't check this rule." },
];

export function ContactDuplicateRulesTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<ContactDuplicateRule>("/api/v1/crm/settings/contact-duplicate-rules");
  const [draft, setDraft] = useState<ContactDuplicateRule[] | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;
  const current = draft ?? rows;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(rows);
  const set = (rule: ContactDuplicateRule["rule"], action: ContactDuplicateAction) => setDraft(current.map((r) => (r.rule === rule ? { ...r, action } : r)));

  const save = async () => {
    setBusy(true);
    const res = await crmRequest("/api/v1/crm/settings/contact-duplicate-rules", { method: "PUT", body: { rules: current }, successMessage: "Contact duplicate rules saved." });
    setBusy(false);
    if (res.ok) {
      setDraft(null);
      reload();
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Checked when a contact is created (form, lead conversion) or its details change. Emails are compared ignoring case (extra emails included); numbers by their last 10 digits; names ignoring case and spacing. Archived contacts are included; merged contacts are not.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Rule</th>
              <th className="px-3 py-2">When a match is found</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {current.map((r) => (
              <tr key={r.rule}>
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{CONTACT_DUPLICATE_RULE_LABELS[r.rule]}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={CONTACT_DUPLICATE_RULE_LABELS[r.rule]}>
                    {ACTIONS.map((a) => (
                      <label key={a.value} title={a.help} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                        <input type="radio" name={`cdup-${r.rule}`} checked={r.action === a.value} disabled={!canEdit} onChange={() => set(r.rule, a.value)} />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="text-xs text-zinc-500 dark:text-zinc-400">
        {ACTIONS.map((a) => (
          <li key={a.value}>
            <span className="font-medium">{a.label}:</span> {a.help}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDraft(null)} disabled={!dirty || busy}>
            Discard
          </Button>
          <Button onClick={save} disabled={!dirty} isLoading={busy} loadingLabel="Saving…">
            Save rules
          </Button>
        </div>
      )}
    </div>
  );
}

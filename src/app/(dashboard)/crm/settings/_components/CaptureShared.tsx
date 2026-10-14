"use client";

import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { LeadSourceDto, UserRefDto } from "../../leads/_components/lead-types";

export type Policy = "SKIP" | "UPDATE" | "CREATE" | "FLAG_FOR_REVIEW";
export const POLICY_LABELS: Record<Policy, string> = {
  UPDATE: "Update the existing lead (fill empty fields)",
  SKIP: "Skip duplicates",
  FLAG_FOR_REVIEW: "Flag for review",
  CREATE: "Create anyway",
};

export interface CaptureDefaults {
  defaultSourceId: string | null;
  defaultOwnerUserId: string | null;
  duplicatePolicy: Policy;
}

/** Default source, default owner and duplicate policy — shared by API keys and webhooks. */
export function CaptureDefaultsFields({ value, onChange, sources, users, idPrefix }: { value: CaptureDefaults; onChange: (v: CaptureDefaults) => void; sources: LeadSourceDto[]; users: UserRefDto[]; idPrefix: string }) {
  return (
    <>
      <FormField label="Lead source" htmlFor={`${idPrefix}-source`}>
        <select id={`${idPrefix}-source`} className={textInputClass()} value={value.defaultSourceId ?? ""} onChange={(e) => onChange({ ...value, defaultSourceId: e.target.value || null })}>
          <option value="">Automatic (Website / API)</option>
          {sources
            .filter((s) => s.isActive !== false)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </FormField>
      <FormField label="Owner of new leads" htmlFor={`${idPrefix}-owner`}>
        <SearchableSelect
          id={`${idPrefix}-owner`}
          value={value.defaultOwnerUserId ?? ""}
          onChange={(v) => onChange({ ...value, defaultOwnerUserId: v || null })}
          options={users.map((u) => ({ id: u.id, label: u.fullName }))}
          emptyOptionLabel="— Unassigned —"
          placeholder="Search people…"
        />
      </FormField>
      <FormField label="When the lead already exists" htmlFor={`${idPrefix}-policy`}>
        <select id={`${idPrefix}-policy`} className={textInputClass()} value={value.duplicatePolicy} onChange={(e) => onChange({ ...value, duplicatePolicy: e.target.value as Policy })}>
          {(Object.keys(POLICY_LABELS) as Policy[]).map((p) => (
            <option key={p} value={p}>
              {POLICY_LABELS[p]}
            </option>
          ))}
        </select>
      </FormField>
    </>
  );
}

// Phase 22: moved to components/crm so workflows and settings share one implementation.
export { SecretOnce, copyText } from "@/components/crm/SecretOnce";

export function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">{children}</pre>;
}

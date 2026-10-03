"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { formatCustomFieldValue } from "@/components/crm/CrmCustomFields";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";
import type { ContactDetailDto } from "./contact-types";

type Counts = { leads: number; opportunities: number; notes: number; documents: number; tags: number; addresses: number; channels: number };
interface PreviewDto {
  survivor: ContactDetailDto & { counts: Counts };
  merged: ContactDetailDto & { counts: Counts };
  fields: string[];
  customFields: CrmCustomFieldDefinitionDto[];
}
type Choice = "survivor" | "merged";

const FIELD_LABELS: Record<string, string> = {
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  designation: "Designation",
  department: "Department",
  relationshipRole: "Relationship role",
  email: "Email",
  alternateEmail: "Alternate email",
  phone: "Phone",
  mobile: "Mobile",
  whatsapp: "WhatsApp",
  crmCompanyId: "Company",
  sourceId: "Source",
  ownerUserId: "Owner",
};

function display(c: ContactDetailDto, field: string): string {
  if (field === "crmCompanyId") return c.crmCompany?.name ?? "";
  if (field === "sourceId") return c.source?.name ?? "";
  if (field === "ownerUserId") return c.owner ? `${c.owner.fullName}${c.ownerInactive ? " (inactive)" : ""}` : "";
  const v = (c as unknown as Record<string, unknown>)[field];
  return v === null || v === undefined ? "" : String(v);
}

const blank = (v: unknown) => v === null || v === undefined || v === "";
const COUNT_LABELS: [keyof Counts, string, string][] = [
  ["leads", "lead", "leads"],
  ["opportunities", "opportunity", "opportunities"],
  ["notes", "note", "notes"],
  ["documents", "document", "documents"],
  ["tags", "tag", "tags"],
  ["addresses", "address", "addresses"],
  ["channels", "extra contact detail", "extra contact details"],
];

export function ContactMergeClient({ initialIds }: { initialIds: string[] }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(initialIds[0] ?? "");
  const [otherId, setOtherId] = useState(initialIds[1] ?? "");
  const [lookup, setLookup] = useState<{ id: string; fullName: string; email: string | null; phone: string | null; crmCompany: { name: string } | null }[]>([]);
  const pairKey = keepId && otherId ? `${keepId}|${otherId}` : "";
  const [loaded, setLoaded] = useState<{ key: string; data: PreviewDto | null; error: string | null }>({ key: "", data: null, error: null });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const preview = loaded.key === pairKey ? loaded.data : null;
  const error = submitError ?? (loaded.key === pairKey ? loaded.error : null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [cfChoices, setCfChoices] = useState<Record<string, Choice>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/crm/contacts/lookup?limit=200")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setLookup(b.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!keepId || !otherId) return;
    let cancelled = false;
    const key = `${keepId}|${otherId}`;
    crmRequest<PreviewDto>(`/api/v1/crm/contacts/merge/preview?survivorId=${keepId}&mergedId=${otherId}`).then((res) => {
      if (cancelled) return;
      setSubmitError(null);
      if (!res.ok) return setLoaded({ key, data: null, error: res.error.message });
      setLoaded({ key, data: res.data, error: null });
      const defaults: Record<string, Choice> = {};
      for (const f of res.data.fields) defaults[f] = blank((res.data.survivor as unknown as Record<string, unknown>)[f]) && !blank((res.data.merged as unknown as Record<string, unknown>)[f]) ? "merged" : "survivor";
      setChoices(defaults);
      setCfChoices({});
    });
    return () => {
      cancelled = true;
    };
  }, [keepId, otherId]);

  const differing = useMemo(() => (preview ? preview.fields.filter((f) => display(preview.survivor, f) !== display(preview.merged, f)) : []), [preview]);
  const cfKeys = useMemo(() => {
    if (!preview) return [];
    const a = preview.survivor.customFields ?? {};
    const b = preview.merged.customFields ?? {};
    return preview.customFields.filter((d) => !blank(b[d.key]) && JSON.stringify(a[d.key]) !== JSON.stringify(b[d.key]));
  }, [preview]);

  const pickerOptions = lookup.map((c) => ({ id: c.id, label: c.fullName, sublabel: [c.crmCompany?.name, c.email, c.phone].filter(Boolean).join(" · ") || undefined }));

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    const res = await crmRequest<{ survivor: { id: string } }>("/api/v1/crm/contacts/merge", {
      method: "POST",
      body: { survivorId: keepId, mergedId: otherId, fieldChoices: choices, customFieldChoices: cfChoices, survivorVersion: preview.survivor.version, mergedVersion: preview.merged.version },
      toast: "errors",
    });
    setBusy(false);
    setConfirm(false);
    if (!res.ok) return setSubmitError(res.error.message);
    toast.success("Contacts merged.");
    router.push(`/crm/contacts/${res.data.survivor.id}`);
    router.refresh();
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800">
        <FormField label="Keep this contact" htmlFor="merge-keep" required>
          <SearchableSelect id="merge-keep" value={keepId} onChange={setKeepId} options={pickerOptions.filter((o) => o.id !== otherId)} placeholder="Search contacts…" emptyOptionLabel={keepId && !lookup.some((c) => c.id === keepId) ? (preview?.survivor.fullName ?? "Selected contact") : "— Select —"} />
        </FormField>
        <FormField label="Merge this contact into it" htmlFor="merge-other" required>
          <SearchableSelect id="merge-other" value={otherId} onChange={setOtherId} options={pickerOptions.filter((o) => o.id !== keepId)} placeholder="Search contacts…" emptyOptionLabel={otherId && !lookup.some((c) => c.id === otherId) ? (preview?.merged.fullName ?? "Selected contact") : "— Select —"} />
        </FormField>
        {keepId && otherId && (
          <div className="sm:col-span-2">
            <button
              type="button"
              className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() => {
                setKeepId(otherId);
                setOtherId(keepId);
              }}
            >
              ⇄ Swap — keep the other contact instead
            </button>
          </div>
        )}
      </div>

      {error && <CrmErrorState message={error} />}
      {keepId && otherId && !preview && !error && <CrmLoadingState />}
      {(!keepId || !otherId) && <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose the two contacts that are the same person.</p>}

      {preview && (
        <>
          <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Choose the values to keep</h2>
            {differing.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">The two contacts have the same core details.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="text-left text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-3">Field</th>
                      <th className="py-2 pr-3">
                        <Link href={`/crm/contacts/${preview.survivor.id}`} target="_blank" className="hover:underline">
                          {preview.survivor.fullName} (kept)
                        </Link>
                      </th>
                      <th className="py-2">
                        <Link href={`/crm/contacts/${preview.merged.id}`} target="_blank" className="hover:underline">
                          {preview.merged.fullName} (merged)
                        </Link>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {differing.map((f) => (
                      <tr key={f}>
                        <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300">{FIELD_LABELS[f] ?? f}</td>
                        {(["survivor", "merged"] as const).map((side) => (
                          <td key={side} className="py-2 pr-3">
                            <label className="flex items-center gap-2">
                              <input type="radio" name={`merge-${f}`} checked={choices[f] === side} onChange={() => setChoices((c) => ({ ...c, [f]: side }))} />
                              <span className={display(preview[side], f) ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}>{display(preview[side], f) || "(empty)"}</span>
                            </label>
                          </td>
                        ))}
                      </tr>
                    ))}
                    {cfKeys.map((d) => (
                      <tr key={`cf-${d.key}`}>
                        <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300">{d.label}</td>
                        {(["survivor", "merged"] as const).map((side) => {
                          const value = (preview[side].customFields ?? {})[d.key];
                          const current = cfChoices[d.key] ?? (blank((preview.survivor.customFields ?? {})[d.key]) ? "merged" : "survivor");
                          return (
                            <td key={side} className="py-2 pr-3">
                              <label className="flex items-center gap-2">
                                <input type="radio" name={`merge-cf-${d.key}`} checked={current === side} onChange={() => setCfChoices((c) => ({ ...c, [d.key]: side }))} />
                                <span className={blank(value) ? "text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}>{blank(value) ? "(empty)" : formatCustomFieldValue(d, value)}</span>
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Emails and numbers you don&apos;t keep here are not lost — they are added to the kept contact as extra contact details.</p>
          </section>

          <section className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">What happens</h2>
            <ul className="list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-200">
              <li>
                Moved to <strong>{preview.survivor.fullName}</strong>:{" "}
                {COUNT_LABELS.filter(([k]) => preview.merged.counts[k] > 0)
                  .map(([k, one, many]) => `${preview.merged.counts[k]} ${preview.merged.counts[k] === 1 ? one : many}`)
                  .join(", ") || "nothing else to move"}
                .
              </li>
              <li>Do-not-contact settings: for each channel the stricter setting of the two is kept.</li>
              <li>
                <strong>{preview.merged.fullName}</strong> is archived and marked as merged — it is not deleted, and its history stays visible on the kept contact&apos;s timeline.
              </li>
              <li>This can&apos;t be undone from the screen; a full snapshot of the merged contact is stored with the merge record.</li>
            </ul>
          </section>

          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Merge contacts
            </Button>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirm}
        title="Merge these contacts?"
        message={preview ? `${preview.merged.fullName} will be merged into ${preview.survivor.fullName}.` : ""}
        confirmLabel="Merge"
        isDangerous
        isBusy={busy}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

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
import type { CompanyDetailDto } from "./company-types";

type Counts = { contacts: number; leads: number; opportunities: number; notes: number; documents: number; tags: number; addresses: number };
interface PreviewDto {
  survivor: CompanyDetailDto & { counts: Counts };
  merged: CompanyDetailDto & { counts: Counts };
  fields: string[];
  conflicts: string[];
  customFieldConflicts: string[];
  customFields: CrmCustomFieldDefinitionDto[];
  erpConflict: boolean;
  erpLinkMoves: boolean;
}
type Choice = "survivor" | "merged";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  legalName: "Legal name",
  displayName: "Display name",
  companyType: "Company type",
  industry: "Industry",
  website: "Website",
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  city: "City",
  state: "State",
  postalCode: "Postal code",
  country: "Country",
  statusId: "Status",
  sourceId: "Source",
  ownerUserId: "Owner",
  primaryContactId: "Primary contact",
};

function display(c: CompanyDetailDto, field: string): string {
  if (field === "statusId") return c.status?.name ?? "";
  if (field === "sourceId") return c.source?.name ?? "";
  if (field === "ownerUserId") return c.owner ? `${c.owner.fullName}${c.ownerInactive ? " (inactive)" : ""}` : "";
  if (field === "primaryContactId") return c.primaryContact?.fullName ?? "";
  const v = (c as unknown as Record<string, unknown>)[field];
  return v === null || v === undefined ? "" : String(v);
}

const blank = (v: unknown) => v === null || v === undefined || v === "";
const COUNT_LABELS: [keyof Counts, string, string][] = [
  ["contacts", "contact", "contacts"],
  ["leads", "lead", "leads"],
  ["opportunities", "opportunity", "opportunities"],
  ["notes", "note", "notes"],
  ["documents", "document", "documents"],
  ["tags", "tag", "tags"],
  ["addresses", "address", "addresses"],
];

/**
 * Two-company merge. Conflicting values (both filled, different) must be
 * chosen explicitly; empty values are filled from the other company.
 * Companies linked to different ERP customers can't be merged here.
 */
export function CompanyMergeClient({ initialIds }: { initialIds: string[] }) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(initialIds[0] ?? "");
  const [otherId, setOtherId] = useState(initialIds[1] ?? "");
  const [lookup, setLookup] = useState<{ id: string; name: string; city: string | null; website: string | null; customer: { code: string } | null }[]>([]);
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
    fetch("/api/v1/crm/companies/lookup?limit=200")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setLookup(b.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!keepId || !otherId) return;
    let cancelled = false;
    const key = `${keepId}|${otherId}`;
    crmRequest<PreviewDto>(`/api/v1/crm/companies/merge/preview?survivorId=${keepId}&mergedId=${otherId}`).then((res) => {
      if (cancelled) return;
      setSubmitError(null);
      if (!res.ok) return setLoaded({ key, data: null, error: res.error.message });
      setLoaded({ key, data: res.data, error: null });
      setChoices({});
      setCfChoices({});
    });
    return () => {
      cancelled = true;
    };
  }, [keepId, otherId]);

  const differing = useMemo(() => (preview ? preview.fields.filter((f) => display(preview.survivor, f) !== display(preview.merged, f)) : []), [preview]);
  const cfRows = useMemo(() => (preview ? preview.customFields.filter((d) => preview.customFieldConflicts.includes(d.key)) : []), [preview]);
  const unresolved = preview ? [...preview.conflicts.filter((f) => !choices[f]), ...preview.customFieldConflicts.filter((k) => !cfChoices[k])] : [];

  /** Shown choice: explicit pick, else the deterministic default (fill blanks from the other side, keep survivor otherwise). */
  const effective = (f: string): Choice | null => {
    if (!preview) return null;
    if (choices[f]) return choices[f];
    if (preview.conflicts.includes(f)) return null;
    return blank(display(preview.survivor, f)) && !blank(display(preview.merged, f)) ? "merged" : "survivor";
  };

  const pickerOptions = lookup.map((c) => ({ id: c.id, label: c.name, sublabel: [c.customer ? `ERP ${c.customer.code}` : null, c.city, c.website].filter(Boolean).join(" · ") || undefined }));

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    const res = await crmRequest<{ survivor: { id: string } }>("/api/v1/crm/companies/merge", {
      method: "POST",
      body: { survivorId: keepId, mergedId: otherId, fieldChoices: choices, customFieldChoices: cfChoices, survivorVersion: preview.survivor.version, mergedVersion: preview.merged.version },
      toast: "errors",
    });
    setBusy(false);
    setConfirm(false);
    if (!res.ok) return setSubmitError(res.error.message);
    toast.success("Companies merged.");
    router.push(`/crm/companies/${res.data.survivor.id}`);
    router.refresh();
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div className="grid gap-4 rounded-lg border border-zinc-200 p-4 sm:grid-cols-2 dark:border-zinc-800">
        <FormField label="Keep this company" htmlFor="merge-keep" required>
          <SearchableSelect id="merge-keep" value={keepId} onChange={setKeepId} options={pickerOptions.filter((o) => o.id !== otherId)} placeholder="Search companies…" emptyOptionLabel={keepId && !lookup.some((c) => c.id === keepId) ? (preview?.survivor.name ?? "Selected company") : "— Select —"} />
        </FormField>
        <FormField label="Merge this company into it" htmlFor="merge-other" required>
          <SearchableSelect id="merge-other" value={otherId} onChange={setOtherId} options={pickerOptions.filter((o) => o.id !== keepId)} placeholder="Search companies…" emptyOptionLabel={otherId && !lookup.some((c) => c.id === otherId) ? (preview?.merged.name ?? "Selected company") : "— Select —"} />
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
              ⇄ Swap — keep the other company instead
            </button>
          </div>
        )}
      </div>

      {error && <CrmErrorState message={error} />}
      {keepId && otherId && !preview && !error && <CrmLoadingState />}
      {(!keepId || !otherId) && <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose the two companies that are the same organisation.</p>}

      {preview?.erpConflict && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          These companies are linked to different ERP customers ({preview.survivor.customer?.code} and {preview.merged.customer?.code}). The CRM can&apos;t merge ERP customers — resolve the duplicate customer in the ERP first, or unlink one of
          them, then merge here.
        </div>
      )}

      {preview && !preview.erpConflict && (
        <>
          <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Choose the values to keep</h2>
            {differing.length === 0 && cfRows.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">The two companies have the same core details.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="text-left text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
                    <tr>
                      <th className="py-2 pr-3">Field</th>
                      <th className="py-2 pr-3">
                        <Link href={`/crm/companies/${preview.survivor.id}`} target="_blank" className="hover:underline">
                          {preview.survivor.name} (kept)
                        </Link>
                      </th>
                      <th className="py-2">
                        <Link href={`/crm/companies/${preview.merged.id}`} target="_blank" className="hover:underline">
                          {preview.merged.name} (merged)
                        </Link>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {differing.map((f) => {
                      const conflict = preview.conflicts.includes(f);
                      return (
                        <tr key={f} className={conflict && !choices[f] ? "bg-amber-50 dark:bg-amber-500/10" : undefined}>
                          <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300">
                            {FIELD_LABELS[f] ?? f}
                            {conflict && <span className="block text-xs text-amber-700 dark:text-amber-300">Choose one</span>}
                          </td>
                          {(["survivor", "merged"] as const).map((side) => (
                            <td key={side} className="py-2 pr-3">
                              <label className="flex items-center gap-2">
                                <input type="radio" name={`merge-${f}`} checked={effective(f) === side} onChange={() => setChoices((c) => ({ ...c, [f]: side }))} />
                                <span className={display(preview[side], f) ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400"}>{display(preview[side], f) || "(empty)"}</span>
                              </label>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {cfRows.map((d) => (
                      <tr key={`cf-${d.key}`} className={!cfChoices[d.key] ? "bg-amber-50 dark:bg-amber-500/10" : undefined}>
                        <td className="py-2 pr-3 text-zinc-600 dark:text-zinc-300">
                          {d.label}
                          <span className="block text-xs text-amber-700 dark:text-amber-300">Choose one</span>
                        </td>
                        {(["survivor", "merged"] as const).map((side) => {
                          const value = (preview[side].customFields ?? {})[d.key];
                          return (
                            <td key={side} className="py-2 pr-3">
                              <label className="flex items-center gap-2">
                                <input type="radio" name={`merge-cf-${d.key}`} checked={cfChoices[d.key] === side} onChange={() => setCfChoices((c) => ({ ...c, [d.key]: side }))} />
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
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Values you don&apos;t keep are written to a note on the kept company, so nothing is lost.</p>
          </section>

          <section className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">What happens</h2>
            <ul className="list-disc space-y-1 pl-5 text-zinc-700 dark:text-zinc-200">
              <li>
                Moved to <strong>{preview.survivor.name}</strong>:{" "}
                {COUNT_LABELS.filter(([k]) => preview.merged.counts[k] > 0)
                  .map(([k, one, many]) => `${preview.merged.counts[k]} ${preview.merged.counts[k] === 1 ? one : many}`)
                  .join(", ") || "nothing else to move"}
                .
              </li>
              <li>
                {preview.erpLinkMoves
                  ? `The ERP customer link (${preview.merged.customer?.code}) moves to ${preview.survivor.name}. The ERP customer itself is not changed.`
                  : preview.survivor.customer
                    ? `${preview.survivor.name} keeps its ERP customer link (${preview.survivor.customer.code}).`
                    : "Neither company is linked to an ERP customer."}
              </li>
              <li>
                <strong>{preview.merged.name}</strong> is archived and marked as merged — it is not deleted, and its history stays visible on the kept company&apos;s timeline.
              </li>
              <li>This can&apos;t be undone from the screen; a full snapshot of the merged company is stored with the merge record.</li>
            </ul>
          </section>

          {unresolved.length > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Choose a value for: {unresolved.map((f) => FIELD_LABELS[f] ?? preview.customFields.find((d) => d.key === f)?.label ?? f).join(", ")}.</p>}
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setConfirm(true)} disabled={unresolved.length > 0}>
              Merge companies
            </Button>
            <Button variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </>
      )}

      <ConfirmModal
        open={confirm}
        title="Merge these companies?"
        message={preview ? `${preview.merged.name} will be merged into ${preview.survivor.name}.` : ""}
        confirmLabel="Merge"
        isDangerous
        isBusy={busy}
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

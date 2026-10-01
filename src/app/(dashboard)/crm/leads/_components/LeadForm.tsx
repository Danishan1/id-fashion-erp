"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmCustomFieldInputs } from "@/components/crm/CrmCustomFields";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTagInput, type CrmTagChip } from "@/components/crm/CrmTagInput";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import { COUNTRIES } from "@/lib/countries";
import type { DuplicateMatchDto, LeadDetailDto } from "./lead-types";
import { useLeadLookups } from "./useLeadLookups";

type Values = Record<string, string>;

const TEXT_KEYS = [
  "firstName",
  "lastName",
  "designation",
  "companyName",
  "crmCompanyId",
  "email",
  "alternateEmail",
  "phone",
  "mobile",
  "whatsapp",
  "statusId",
  "sourceId",
  "ownerUserId",
  "temperature",
  "score",
  "estimatedValue",
  "currencyCode",
  "industry",
  "city",
  "state",
  "country",
  "requirement",
  "campaignSource",
  "referralSource",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmTerm",
  "utmContent",
  "lastContactedAt",
  "nextFollowUpAt",
] as const;
const DUP_KEYS = ["email", "alternateEmail", "phone", "mobile", "whatsapp", "companyName"] as const;

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialValues(lead?: LeadDetailDto, defaults?: { statusId?: string; sourceId?: string; ownerUserId?: string; currencyCode: string }): Values {
  if (!lead) {
    return {
      ...Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])),
      statusId: defaults?.statusId ?? "",
      sourceId: defaults?.sourceId ?? "",
      ownerUserId: defaults?.ownerUserId ?? "",
      currencyCode: defaults?.currencyCode ?? "",
      score: "0",
    };
  }
  const v: Values = {};
  for (const k of TEXT_KEYS) {
    const raw = (lead as unknown as Record<string, unknown>)[k];
    v[k] = raw === null || raw === undefined ? "" : String(raw);
  }
  v.lastContactedAt = toLocalInput(lead.lastContactedAt);
  v.nextFollowUpAt = toLocalInput(lead.nextFollowUpAt);
  return v;
}

function DuplicatePanel({ matches, mode, onConfirm, busy }: { matches: DuplicateMatchDto[]; mode: "live" | "warn" | "block"; onConfirm?: () => void; busy?: boolean }) {
  if (!matches.length) return null;
  const blocking = mode === "block" || matches.some((m) => m.action === "BLOCK");
  return (
    <div role="alert" className={`rounded-md border p-3 text-sm ${blocking ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"}`}>
      <p className={`font-medium ${blocking ? "text-red-800 dark:text-red-200" : "text-amber-900 dark:text-amber-200"}`}>
        {blocking ? "A lead with these details already exists — saving is blocked by your duplicate rules." : "Possible duplicate found."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-zinc-800 dark:text-zinc-100">
              <span className="font-medium">{m.fullName}</span>
              {m.companyName && ` · ${m.companyName}`} <span className="text-xs text-zinc-500">({m.leadNumber}{m.archived ? ", archived" : ""})</span>
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                {[m.phone && `Phone: ${m.phone}`, m.email && `Email: ${m.email}`, `Status: ${m.status}`, m.owner && `Owner: ${m.owner}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Link href={`/crm/leads/${m.id}`} target="_blank" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
              Open existing ↗
            </Link>
          </li>
        ))}
      </ul>
      {mode === "warn" && onConfirm && (
        <div className="mt-3">
          <Button variant="secondary" onClick={onConfirm} isLoading={busy} loadingLabel="Saving…">
            Save anyway
          </Button>
        </div>
      )}
    </div>
  );
}

export function LeadForm({ lead, currentUserId }: { lead?: LeadDetailDto; currentUserId: string }) {
  const router = useRouter();
  const { meta, users, error: lookupError, reload } = useLeadLookups();
  const [values, setValues] = useState<Values | null>(lead ? initialValues(lead) : null);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(lead?.customFields ?? {});
  const [tags, setTags] = useState<CrmTagChip[]>([]);
  const [showAttribution, setShowAttribution] = useState(Boolean(lead && (lead.utmSource || lead.campaignSource || lead.referralSource)));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMatches, setLiveMatches] = useState<DuplicateMatchDto[]>([]);
  const [saveMatches, setSaveMatches] = useState<{ matches: DuplicateMatchDto[]; mode: "warn" | "block" } | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!meta || values) return;
    const def = meta.statuses.find((s) => s.isDefault && s.isActive !== false);
    const manual = meta.sources.find((s) => s.key === "manual" && s.isActive !== false);
    setValues(initialValues(undefined, { statusId: def?.id, sourceId: manual?.id, ownerUserId: users.some((u) => u.id === currentUserId) ? currentUserId : "", currencyCode: meta.baseCurrencyCode }));
  }, [meta, users, values, currentUserId]);

  useEffect(() => {
    fetch("/api/v1/crm/companies/lookup")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => setCompanies(b.data ?? []))
      .catch(() => {});
  }, []);

  const dupKey = values ? DUP_KEYS.map((k) => values[k]).join("|") : "";
  useEffect(() => {
    if (!values || !DUP_KEYS.some((k) => k !== "companyName" && values[k].trim())) {
      setLiveMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const body = { ...Object.fromEntries(DUP_KEYS.map((k) => [k, values[k] || null])), excludeLeadId: lead?.id ?? null };
      const res = await crmRequest<{ matches: DuplicateMatchDto[] }>("/api/v1/crm/leads/duplicate-check", { method: "POST", body, toast: "off" });
      if (res.ok) setLiveMatches(res.data.matches);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, lead?.id]);

  const statusOptions = useMemo(
    () => (meta?.statuses ?? []).filter((s) => (s.isActive !== false && s.kind !== "CONVERTED") || s.id === lead?.statusId),
    [meta, lead?.statusId]
  );
  const sourceOptions = useMemo(() => (meta?.sources ?? []).filter((s) => s.isActive !== false || s.id === lead?.sourceId), [meta, lead?.sourceId]);
  const ownerOptions = useMemo(() => {
    const opts = users.map((u) => ({ id: u.id, label: u.fullName }));
    if (lead?.owner && !opts.some((o) => o.id === lead.owner!.id)) opts.unshift({ id: lead.owner.id, label: `${lead.owner.fullName} (inactive)` });
    return opts;
  }, [users, lead?.owner]);

  if (lookupError) return <CrmErrorState message={lookupError} onRetry={reload} />;
  if (!meta || !values) return <CrmLoadingState />;

  const set = (k: string, v: string) => setValues((prev) => ({ ...(prev as Values), [k]: v }));
  const err = (k: string) => fieldErrors[k];
  const input = (k: (typeof TEXT_KEYS)[number], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`lead-${k}`} className={textInputClass(Boolean(err(k)))} value={values[k]} onChange={(e) => set(k, e.target.value)} {...props} />
  );
  const statusIsConverted = lead && meta.statuses.find((s) => s.id === lead.statusId)?.kind === "CONVERTED";

  const save = async (confirmDuplicate = false) => {
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(false);
    const payload: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) payload[k] = values[k] === "" ? null : values[k];
    payload.firstName = values.firstName;
    payload.score = values.score === "" ? 0 : Number(values.score);
    payload.estimatedValue = values.estimatedValue === "" ? null : Number(values.estimatedValue);
    payload.lastContactedAt = values.lastContactedAt ? new Date(values.lastContactedAt).toISOString() : null;
    payload.nextFollowUpAt = values.nextFollowUpAt ? new Date(values.nextFollowUpAt).toISOString() : null;
    payload.customFields = customFields;
    if (statusIsConverted) delete payload.statusId;
    if (confirmDuplicate) payload.confirmDuplicate = true;
    if (lead) payload.version = lead.version;
    else {
      payload.tagIds = tags.filter((t) => t.id).map((t) => t.id);
      payload.tagNames = tags.filter((t) => !t.id).map((t) => t.name);
    }

    const res = await crmRequest<{ id: string }>(lead ? `/api/v1/crm/leads/${lead.id}` : "/api/v1/crm/leads", { method: lead ? "PATCH" : "POST", body: payload, toast: "off" });
    setBusy(false);
    if (res.ok) {
      toast.success(lead ? "Lead updated." : "Lead created.");
      router.push(`/crm/leads/${lead?.id ?? res.data.id}`);
      router.refresh();
      return;
    }
    const e = res.error;
    if (e.code === "CRM_POSSIBLE_DUPLICATE" || e.code === "DUPLICATE_LEAD_EXISTS") {
      setSaveMatches({ matches: (e.details?.matches as DuplicateMatchDto[]) ?? [], mode: e.code === "DUPLICATE_LEAD_EXISTS" ? "block" : "warn" });
      return;
    }
    if (e.code === "RECORD_VERSION_CONFLICT") setConflict(true);
    setFieldErrors(e.fieldErrors);
    setFormError(e.message);
    toast.error(e.message);
  };

  const section = "space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";
  const heading = "text-sm font-semibold text-zinc-900 dark:text-zinc-50";

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.firstName.trim()) {
          setFieldErrors({ firstName: "First name is required" });
          return;
        }
        void save();
      }}
      className="max-w-4xl space-y-5"
    >
      {statusIsConverted && <p className="text-sm text-zinc-600 dark:text-zinc-300">This lead has been converted. You can still correct its details; its status stays Converted.</p>}

      <section className={section}>
        <h2 className={heading}>Contact</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="First name" htmlFor="lead-firstName" required error={err("firstName")}>
            {input("firstName", { maxLength: 100, autoFocus: !lead })}
          </FormField>
          <FormField label="Last name" htmlFor="lead-lastName" error={err("lastName")}>
            {input("lastName", { maxLength: 100 })}
          </FormField>
          <FormField label="Email" htmlFor="lead-email" error={err("email")}>
            {input("email", { type: "email", maxLength: 200 })}
          </FormField>
          <FormField label="Alternate email" htmlFor="lead-alternateEmail" error={err("alternateEmail")}>
            {input("alternateEmail", { type: "email", maxLength: 200 })}
          </FormField>
          <FormField label="Phone" htmlFor="lead-phone" error={err("phone")}>
            {input("phone", { type: "tel", maxLength: 30 })}
          </FormField>
          <FormField label="Mobile" htmlFor="lead-mobile" error={err("mobile")}>
            {input("mobile", { type: "tel", maxLength: 30 })}
          </FormField>
          <FormField label="WhatsApp" htmlFor="lead-whatsapp" error={err("whatsapp")}>
            {input("whatsapp", { type: "tel", maxLength: 30, placeholder: "Include country code, e.g. +91…" })}
          </FormField>
          <FormField label="Designation" htmlFor="lead-designation" error={err("designation")}>
            {input("designation", { maxLength: 100 })}
          </FormField>
        </div>
        <DuplicatePanel matches={saveMatches ? [] : liveMatches} mode="live" />
      </section>

      <section className={section}>
        <h2 className={heading}>Company</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Company name" htmlFor="lead-companyName" error={err("companyName")}>
            {input("companyName", { maxLength: 200 })}
          </FormField>
          <FormField label="Link to existing CRM company" htmlFor="lead-crmCompanyId" error={err("crmCompanyId")}>
            <SearchableSelect
              id="lead-crmCompanyId"
              value={values.crmCompanyId}
              onChange={(v) => set("crmCompanyId", v)}
              options={[...companies, ...(lead?.crmCompany && !companies.some((c) => c.id === lead.crmCompany!.id) ? [lead.crmCompany] : [])].map((c) => ({ id: c.id, label: c.name }))}
              placeholder="Search companies…"
              emptyOptionLabel="— Not linked —"
            />
          </FormField>
          <FormField label="Industry" htmlFor="lead-industry" error={err("industry")}>
            {input("industry", { maxLength: 100 })}
          </FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Lead details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Status" htmlFor="lead-statusId" error={err("statusId")}>
            <select id="lead-statusId" className={textInputClass(Boolean(err("statusId")))} value={values.statusId} onChange={(e) => set("statusId", e.target.value)} disabled={Boolean(statusIsConverted)}>
              {statusOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Source" htmlFor="lead-sourceId" error={err("sourceId")}>
            <select id="lead-sourceId" className={textInputClass(Boolean(err("sourceId")))} value={values.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
              <option value="">— None —</option>
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Owner" htmlFor="lead-ownerUserId" error={err("ownerUserId")}>
            <SearchableSelect id="lead-ownerUserId" value={values.ownerUserId} onChange={(v) => set("ownerUserId", v)} options={ownerOptions} placeholder="Search people…" emptyOptionLabel="— Unassigned —" />
          </FormField>
          <FormField label="Temperature" htmlFor="lead-temperature" error={err("temperature")}>
            <select id="lead-temperature" className={textInputClass()} value={values.temperature} onChange={(e) => set("temperature", e.target.value)}>
              <option value="">—</option>
              <option value="HOT">Hot</option>
              <option value="WARM">Warm</option>
              <option value="COLD">Cold</option>
            </select>
          </FormField>
          <FormField label="Score (0–100)" htmlFor="lead-score" error={err("score")}>
            {input("score", { type: "number", min: 0, max: 100, step: 1 })}
          </FormField>
          <FormField label={`Estimated value (${values.currencyCode || meta.baseCurrencyCode})`} htmlFor="lead-estimatedValue" error={err("estimatedValue")}>
            {input("estimatedValue", { type: "number", min: 0, step: "0.01" })}
          </FormField>
          <FormField label="Next follow-up" htmlFor="lead-nextFollowUpAt" error={err("nextFollowUpAt")}>
            {input("nextFollowUpAt", { type: "datetime-local" })}
          </FormField>
          <FormField label="Last contacted" htmlFor="lead-lastContactedAt" error={err("lastContactedAt")}>
            {input("lastContactedAt", { type: "datetime-local" })}
          </FormField>
        </div>
        <FormField label="Requirement" htmlFor="lead-requirement" error={err("requirement")}>
          <textarea id="lead-requirement" rows={4} maxLength={5000} className={textInputClass(Boolean(err("requirement")))} value={values.requirement} onChange={(e) => set("requirement", e.target.value)} placeholder="What are they looking for? Product, quantity, timeline…" />
        </FormField>
      </section>

      <section className={section}>
        <h2 className={heading}>Location</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="City" htmlFor="lead-city" error={err("city")}>
            {input("city", { maxLength: 100 })}
          </FormField>
          <FormField label="State" htmlFor="lead-state" error={err("state")}>
            {input("state", { maxLength: 100 })}
          </FormField>
          <FormField label="Country" htmlFor="lead-country" error={err("country")}>
            <SearchableSelect id="lead-country" value={values.country} onChange={(v) => set("country", v)} options={COUNTRIES.map((c) => ({ id: c, label: c }))} placeholder="Search countries…" emptyOptionLabel="—" />
          </FormField>
        </div>
      </section>

      {!lead && (
        <section className={section}>
          <h2 className={heading}>Tags</h2>
          <CrmTagInput id="lead-tags" value={tags} onChange={setTags} />
        </section>
      )}

      {meta.customFields.some((d) => d.isActive) && (
        <section className={section}>
          <h2 className={heading}>Additional information</h2>
          <CrmCustomFieldInputs definitions={meta.customFields} values={customFields} onChange={(k, v) => setCustomFields((c) => ({ ...c, [k]: v }))} errors={fieldErrors} />
        </section>
      )}

      <section className={section}>
        <button type="button" onClick={() => setShowAttribution((s) => !s)} aria-expanded={showAttribution} className={`${heading} flex w-full items-center justify-between`}>
          Source & attribution <span className="text-xs font-normal text-zinc-400">{showAttribution ? "Hide ▲" : "Show ▼"}</span>
        </button>
        {showAttribution && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Campaign source" htmlFor="lead-campaignSource">
              {input("campaignSource", { maxLength: 200 })}
            </FormField>
            <FormField label="Referred by" htmlFor="lead-referralSource">
              {input("referralSource", { maxLength: 200 })}
            </FormField>
            {(["utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent"] as const).map((k) => (
              <FormField key={k} label={`UTM ${k.slice(3).toLowerCase()}`} htmlFor={`lead-${k}`}>
                {input(k, { maxLength: 200 })}
              </FormField>
            ))}
          </div>
        )}
      </section>

      {saveMatches && <DuplicatePanel matches={saveMatches.matches} mode={saveMatches.mode} onConfirm={() => save(true)} busy={busy} />}
      {formError && !saveMatches && (
        <div className="space-y-2">
          <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
          {conflict && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload latest version
            </Button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" isLoading={busy} loadingLabel="Saving…">
          {lead ? "Save changes" : "Create lead"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(lead ? `/crm/leads/${lead.id}` : "/crm/leads")} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

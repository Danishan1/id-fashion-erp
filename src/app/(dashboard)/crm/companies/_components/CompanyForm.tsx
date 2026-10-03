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
import { COMPANY_DUPLICATE_RULE_LABELS } from "@/modules/crm/companies/company-registry";
import { ADDRESS_TYPES } from "@/modules/crm/contacts/contact-registry";
import type { CompanyDetailDto, CompanyDuplicateMatchDto, CustomerOptionDto } from "./company-types";
import { useCompanyLookups } from "./useCompanyLookups";

type Values = Record<string, string>;

const TEXT_KEYS = [
  "name",
  "legalName",
  "displayName",
  "companyType",
  "industry",
  "website",
  "email",
  "phone",
  "mobile",
  "city",
  "state",
  "postalCode",
  "country",
  "statusId",
  "sourceId",
  "ownerUserId",
] as const;
const DUP_KEYS = ["name", "legalName", "website", "email", "phone", "mobile"] as const;
const ADDRESS_KEYS = ["addressType", "line1", "line2", "city", "state", "postalCode", "country"] as const;

const RULE_LABELS: Record<string, string> = { ...COMPANY_DUPLICATE_RULE_LABELS, ERP_CUSTOMER: "same ERP customer" };

export function CompanyDuplicatePanel({ matches, mode, onConfirm, busy }: { matches: CompanyDuplicateMatchDto[]; mode: "live" | "warn" | "block"; onConfirm?: () => void; busy?: boolean }) {
  if (!matches.length) return null;
  const blocking = mode === "block" || matches.some((m) => m.action === "BLOCK");
  const flagOnly = matches.every((m) => m.action === "FLAG");
  return (
    <div role="alert" className={`rounded-md border p-3 text-sm ${blocking ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"}`}>
      <p className={`font-medium ${blocking ? "text-red-800 dark:text-red-200" : "text-amber-900 dark:text-amber-200"}`}>
        {blocking ? "A company with these details already exists — saving is blocked by your duplicate rules." : flagOnly ? "Similar companies exist. This company will be saved and flagged for review." : "Possible duplicate company found."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-zinc-800 dark:text-zinc-100">
              <span className="font-medium">{m.name}</span>
              {m.city && ` · ${m.city}`}
              {m.archived && <span className="text-xs text-zinc-500"> (archived)</span>}
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                {[m.website && `Web: ${m.website}`, m.email && `Email: ${m.email}`, m.phone && `Phone: ${m.phone}`, m.customer && `ERP: ${m.customer.code}`, m.owner && `Owner: ${m.owner}`, `Matched: ${m.rules.map((r) => RULE_LABELS[r] ?? r).join(", ")}`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Link href={`/crm/companies/${m.id}`} target="_blank" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
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

/** Inline server-side ERP customer search (create form only). Customers already linked elsewhere can't be picked. */
function CustomerPicker({ value, onChange }: { value: CustomerOptionDto | null; onChange: (c: CustomerOptionDto | null) => void }) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CustomerOptionDto[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(() => {
      crmRequest<CustomerOptionDto[]>(`/api/v1/crm/companies/customers?limit=10${term.trim() ? `&search=${encodeURIComponent(term.trim())}` : ""}`).then((res) => {
        if (!cancelled && res.ok) setRows(res.data);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, open]);

  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
        <span>
          <span className="font-medium">{value.name}</span> <span className="text-xs text-zinc-500">{[value.code, value.city, value.country].filter(Boolean).join(" · ")}</span>
        </span>
        <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div className="relative">
      <input id="company-customer" className={textInputClass()} value={term} placeholder="Search ERP customers by name or code…" onFocus={() => setOpen(true)} onChange={(e) => setTerm(e.target.value)} />
      {open && rows.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={Boolean(c.crmCompanyId)}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-800"
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                {c.name} <span className="text-xs text-zinc-500">{[c.code, c.city, c.crmCompanyId ? `linked to ${c.linkedCompany?.name ?? "a CRM company"}` : null].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function initialValues(company?: CompanyDetailDto, defaults?: { sourceId?: string; ownerUserId?: string; statusId?: string }): Values {
  if (!company) return { ...Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])), sourceId: defaults?.sourceId ?? "", ownerUserId: defaults?.ownerUserId ?? "", statusId: defaults?.statusId ?? "" };
  const v: Values = {};
  for (const k of TEXT_KEYS) {
    const raw = (company as unknown as Record<string, unknown>)[k];
    v[k] = raw === null || raw === undefined ? "" : String(raw);
  }
  return v;
}

export function CompanyForm({ company, currentUserId }: { company?: CompanyDetailDto; currentUserId: string }) {
  const router = useRouter();
  const { meta, users, error: lookupError, reload } = useCompanyLookups();
  const [values, setValues] = useState<Values | null>(company ? initialValues(company) : null);
  const [customer, setCustomer] = useState<CustomerOptionDto | null>(null);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(company?.customFields ?? {});
  const [tags, setTags] = useState<CrmTagChip[]>([]);
  const [address, setAddress] = useState<Values>({ addressType: "OFFICE", line1: "", line2: "", city: "", state: "", postalCode: "", country: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMatches, setLiveMatches] = useState<CompanyDuplicateMatchDto[]>([]);
  const [saveMatches, setSaveMatches] = useState<{ matches: CompanyDuplicateMatchDto[]; mode: "warn" | "block" } | null>(null);

  useEffect(() => {
    if (!meta || values) return;
    const manual = meta.sources.find((s) => s.key === "manual" && s.isActive !== false);
    const status = meta.statuses.find((s) => s.isDefault && s.isActive !== false) ?? meta.statuses.find((s) => s.isActive !== false);
    setValues(initialValues(undefined, { sourceId: manual?.id, statusId: status?.id, ownerUserId: users.some((u) => u.id === currentUserId) ? currentUserId : "" }));
  }, [meta, users, values, currentUserId]);

  const dupKey = values ? [...DUP_KEYS.map((k) => values[k]), customer?.id ?? ""].join("|") : "";
  useEffect(() => {
    if (!values || !DUP_KEYS.some((k) => values[k].trim())) {
      setLiveMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const body = { ...Object.fromEntries(DUP_KEYS.map((k) => [k, values[k] || null])), customerId: customer?.id ?? null, excludeCompanyId: company?.id ?? null };
      const res = await crmRequest<{ matches: CompanyDuplicateMatchDto[] }>("/api/v1/crm/companies/duplicate-check", { method: "POST", body, toast: "off" });
      if (res.ok) setLiveMatches(res.data.matches);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, company?.id]);

  const sourceOptions = useMemo(() => (meta?.sources ?? []).filter((s) => s.isActive !== false || s.id === company?.sourceId), [meta, company?.sourceId]);
  const statusOptions = useMemo(() => (meta?.statuses ?? []).filter((s) => s.isActive !== false || s.id === company?.statusId), [meta, company?.statusId]);
  const ownerOptions = useMemo(() => {
    const opts = users.map((u) => ({ id: u.id, label: u.fullName }));
    if (company?.owner && !opts.some((o) => o.id === company.owner!.id)) opts.unshift({ id: company.owner.id, label: `${company.owner.fullName} (inactive)` });
    return opts;
  }, [users, company?.owner]);

  if (lookupError) return <CrmErrorState message={lookupError} onRetry={reload} />;
  if (!meta || !values) return <CrmLoadingState />;

  const set = (k: string, v: string) => setValues((prev) => ({ ...(prev as Values), [k]: v }));
  const err = (k: string) => fieldErrors[k];
  const input = (k: (typeof TEXT_KEYS)[number], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`company-${k}`} className={textInputClass(Boolean(err(k)))} value={values[k]} onChange={(e) => set(k, e.target.value)} {...props} />
  );
  const suggest = (k: "industry" | "companyType", list: string[]) => (
    <>
      {input(k, { maxLength: 100, list: `company-${k}-options` })}
      <datalist id={`company-${k}-options`}>
        {list.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );

  const save = async (confirmDuplicate = false) => {
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    setConflict(false);
    const payload: Record<string, unknown> = {};
    for (const k of TEXT_KEYS) payload[k] = values[k] === "" ? null : values[k];
    payload.name = values.name;
    payload.customFields = customFields;
    if (confirmDuplicate) payload.confirmDuplicate = true;
    if (company) payload.version = company.version;
    else {
      if (customer) payload.customerId = customer.id;
      payload.tagIds = tags.filter((t) => t.id).map((t) => t.id);
      payload.tagNames = tags.filter((t) => !t.id).map((t) => t.name);
      if (address.line1.trim()) payload.addresses = [{ ...Object.fromEntries(ADDRESS_KEYS.map((k) => [k, address[k] || null])), addressType: address.addressType, line1: address.line1, isPrimary: true }];
    }

    const res = await crmRequest<{ id: string }>(company ? `/api/v1/crm/companies/${company.id}` : "/api/v1/crm/companies", { method: company ? "PATCH" : "POST", body: payload, toast: "off" });
    setBusy(false);
    if (res.ok) {
      toast.success(company ? "Company updated." : "Company created.");
      router.push(`/crm/companies/${company?.id ?? res.data.id}`);
      router.refresh();
      return;
    }
    const e = res.error;
    if (e.code === "CRM_POSSIBLE_DUPLICATE" || (e.code === "CRM_DUPLICATE_RECORD" && e.details?.entityType === "COMPANY")) {
      setSaveMatches({ matches: (e.details?.matches as CompanyDuplicateMatchDto[]) ?? [], mode: e.details?.blocking ? "block" : "warn" });
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
        if (!values.name.trim()) {
          setFieldErrors({ name: "Company name is required" });
          return;
        }
        setSaveMatches(null);
        void save();
      }}
      className="max-w-4xl space-y-5"
    >
      <section className={section}>
        <h2 className={heading}>Company</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Company name" htmlFor="company-name" required error={err("name")}>
            {input("name", { maxLength: 200, autoFocus: !company })}
          </FormField>
          <FormField label="Legal name" htmlFor="company-legalName" error={err("legalName")}>
            {input("legalName", { maxLength: 200, placeholder: "Registered name, if different" })}
          </FormField>
          <FormField label="Display name" htmlFor="company-displayName" error={err("displayName")}>
            {input("displayName", { maxLength: 200 })}
          </FormField>
          <FormField label="Company type" htmlFor="company-companyType" error={err("companyType")}>
            {suggest("companyType", meta.suggestions.company_type ?? [])}
          </FormField>
          <FormField label="Industry" htmlFor="company-industry" error={err("industry")}>
            {suggest("industry", meta.suggestions.company_industry ?? [])}
          </FormField>
          <FormField label="Website" htmlFor="company-website" error={err("website")}>
            {input("website", { maxLength: 300, placeholder: "example.com" })}
          </FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Contact details & location</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Email" htmlFor="company-email" error={err("email")}>
            {input("email", { type: "email", maxLength: 200 })}
          </FormField>
          <FormField label="Phone" htmlFor="company-phone" error={err("phone")}>
            {input("phone", { type: "tel", maxLength: 30 })}
          </FormField>
          <FormField label="Mobile" htmlFor="company-mobile" error={err("mobile")}>
            {input("mobile", { type: "tel", maxLength: 30 })}
          </FormField>
          <FormField label="City" htmlFor="company-city" error={err("city")}>
            {input("city", { maxLength: 100 })}
          </FormField>
          <FormField label="State / region" htmlFor="company-state" error={err("state")}>
            {input("state", { maxLength: 100 })}
          </FormField>
          <FormField label="Postal code" htmlFor="company-postalCode" error={err("postalCode")}>
            {input("postalCode", { maxLength: 20 })}
          </FormField>
          <FormField label="Country" htmlFor="company-country" error={err("country")}>
            <SearchableSelect id="company-country" value={values.country} onChange={(v) => set("country", v)} options={COUNTRIES.map((c) => ({ id: c, label: c }))} placeholder="Search countries…" emptyOptionLabel="—" />
          </FormField>
        </div>
        <CompanyDuplicatePanel matches={saveMatches ? [] : liveMatches} mode="live" />
      </section>

      <section className={section}>
        <h2 className={heading}>CRM</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Status" htmlFor="company-statusId" error={err("statusId")}>
            <select id="company-statusId" className={textInputClass(Boolean(err("statusId")))} value={values.statusId} onChange={(e) => set("statusId", e.target.value)}>
              <option value="">— Default —</option>
              {statusOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Owner" htmlFor="company-ownerUserId" error={err("ownerUserId")}>
            <SearchableSelect id="company-ownerUserId" value={values.ownerUserId} onChange={(v) => set("ownerUserId", v)} options={ownerOptions} placeholder="Search people…" emptyOptionLabel="— Unassigned —" />
          </FormField>
          <FormField label="Source" htmlFor="company-sourceId" error={err("sourceId")}>
            <select id="company-sourceId" className={textInputClass(Boolean(err("sourceId")))} value={values.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
              <option value="">— None —</option>
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {!company && meta.canPickCustomer && (
          <FormField label="ERP customer (optional)" htmlFor="company-customer" error={err("customerId")}>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </FormField>
        )}
        {!company && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {meta.canPickCustomer
              ? "Link an existing ERP customer if this company already buys from you. The CRM never creates or edits ERP customers — create new customers in Masters."
              : "ERP customers can be linked by users who can view customers."}
          </p>
        )}
      </section>

      {!company && (
        <section className={section}>
          <h2 className={heading}>Primary address (optional)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Type" htmlFor="company-addr-type">
              <select id="company-addr-type" className={textInputClass()} value={address.addressType} onChange={(e) => setAddress((a) => ({ ...a, addressType: e.target.value }))}>
                {Object.entries(ADDRESS_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Address line 1" htmlFor="company-addr-line1" error={err("addresses.0.line1")}>
                <input id="company-addr-line1" className={textInputClass()} value={address.line1} maxLength={200} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} />
              </FormField>
            </div>
            {(["line2", "city", "state", "postalCode"] as const).map((k) => (
              <FormField key={k} label={{ line2: "Address line 2", city: "City", state: "State / region", postalCode: "Postal code" }[k]} htmlFor={`company-addr-${k}`}>
                <input id={`company-addr-${k}`} className={textInputClass()} value={address[k]} maxLength={k === "postalCode" ? 20 : 200} onChange={(e) => setAddress((a) => ({ ...a, [k]: e.target.value }))} />
              </FormField>
            ))}
            <FormField label="Country" htmlFor="company-addr-country">
              <SearchableSelect id="company-addr-country" value={address.country} onChange={(v) => setAddress((a) => ({ ...a, country: v }))} options={COUNTRIES.map((c) => ({ id: c, label: c }))} placeholder="Search countries…" emptyOptionLabel="—" />
            </FormField>
          </div>
        </section>
      )}

      {!company && (
        <section className={section}>
          <h2 className={heading}>Tags</h2>
          <CrmTagInput id="company-tags" value={tags} onChange={setTags} />
        </section>
      )}

      {meta.customFields.some((d) => d.isActive) && (
        <section className={section}>
          <h2 className={heading}>Additional information</h2>
          <CrmCustomFieldInputs definitions={meta.customFields} values={customFields} onChange={(k, v) => setCustomFields((c) => ({ ...c, [k]: v }))} errors={fieldErrors} />
        </section>
      )}

      {saveMatches && <CompanyDuplicatePanel matches={saveMatches.matches} mode={saveMatches.mode} onConfirm={() => save(true)} busy={busy} />}
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
          {company ? "Save changes" : "Create company"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(company ? `/crm/companies/${company.id}` : "/crm/companies")} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

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
import { ADDRESS_TYPES } from "@/modules/crm/contacts/contact-registry";
import type { ContactDetailDto, ContactDuplicateMatchDto } from "./contact-types";
import { useContactLookups } from "./useContactLookups";

type Values = Record<string, string>;

const TEXT_KEYS = [
  "firstName",
  "middleName",
  "lastName",
  "designation",
  "department",
  "relationshipRole",
  "email",
  "alternateEmail",
  "phone",
  "mobile",
  "whatsapp",
  "sourceId",
  "ownerUserId",
] as const;
const DUP_KEYS = ["firstName", "middleName", "lastName", "email", "alternateEmail", "phone", "mobile", "whatsapp"] as const;
const ADDRESS_KEYS = ["addressType", "line1", "line2", "city", "state", "postalCode", "country"] as const;

interface CompanyOptions {
  companies: { id: string; name: string; city: string | null; country: string | null; customerId: string | null }[];
  customers: { id: string; code: string; name: string; city: string | null; country: string | null; crmCompanyId: string | null }[] | null;
}

const RULE_LABELS: Record<string, string> = { EMAIL: "same email", PHONE: "same phone", MOBILE: "same mobile", WHATSAPP: "same WhatsApp", NAME_AND_COMPANY: "same name & company", NAME_AND_EMAIL: "same name & email" };

function DuplicatePanel({ matches, mode, onConfirm, busy }: { matches: ContactDuplicateMatchDto[]; mode: "live" | "warn" | "block"; onConfirm?: () => void; busy?: boolean }) {
  if (!matches.length) return null;
  const blocking = mode === "block" || matches.some((m) => m.action === "BLOCK");
  const flagOnly = matches.every((m) => m.action === "FLAG");
  return (
    <div role="alert" className={`rounded-md border p-3 text-sm ${blocking ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"}`}>
      <p className={`font-medium ${blocking ? "text-red-800 dark:text-red-200" : "text-amber-900 dark:text-amber-200"}`}>
        {blocking ? "A contact with these details already exists — saving is blocked by your duplicate rules." : flagOnly ? "Similar contacts exist. This contact will be saved and flagged for review." : "Possible duplicate contact found."}
      </p>
      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-zinc-800 dark:text-zinc-100">
              <span className="font-medium">{m.fullName}</span>
              {m.companyName && ` · ${m.companyName}`}
              {m.archived && <span className="text-xs text-zinc-500"> (archived)</span>}
              <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                {[m.phone && `Phone: ${m.phone}`, m.email && `Email: ${m.email}`, m.owner && `Owner: ${m.owner}`, `Matched: ${m.rules.map((r) => RULE_LABELS[r] ?? r).join(", ")}`].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Link href={`/crm/contacts/${m.id}`} target="_blank" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300">
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

function initialValues(contact?: ContactDetailDto, defaults?: { sourceId?: string; ownerUserId?: string }): Values {
  if (!contact) return { ...Object.fromEntries(TEXT_KEYS.map((k) => [k, ""])), sourceId: defaults?.sourceId ?? "", ownerUserId: defaults?.ownerUserId ?? "" };
  const v: Values = {};
  for (const k of TEXT_KEYS) {
    const raw = (contact as unknown as Record<string, unknown>)[k];
    v[k] = raw === null || raw === undefined ? "" : String(raw);
  }
  return v;
}

export function ContactForm({ contact, currentUserId, initialCompany }: { contact?: ContactDetailDto; currentUserId: string; initialCompany?: { id: string; name: string } | null }) {
  const router = useRouter();
  const { meta, users, error: lookupError, reload } = useContactLookups();
  const [values, setValues] = useState<Values | null>(contact ? initialValues(contact) : null);
  const [company, setCompany] = useState(contact?.crmCompanyId ? `co:${contact.crmCompanyId}` : initialCompany ? `co:${initialCompany.id}` : "");
  const [options, setOptions] = useState<CompanyOptions>({ companies: [], customers: null });
  const [customFields, setCustomFields] = useState<Record<string, unknown>>(contact?.customFields ?? {});
  const [tags, setTags] = useState<CrmTagChip[]>([]);
  const [address, setAddress] = useState<Values>({ addressType: "OFFICE", line1: "", line2: "", city: "", state: "", postalCode: "", country: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMatches, setLiveMatches] = useState<ContactDuplicateMatchDto[]>([]);
  const [saveMatches, setSaveMatches] = useState<{ matches: ContactDuplicateMatchDto[]; mode: "warn" | "block" } | null>(null);

  useEffect(() => {
    if (!meta || values) return;
    const manual = meta.sources.find((s) => s.key === "manual" && s.isActive !== false);
    setValues(initialValues(undefined, { sourceId: manual?.id, ownerUserId: users.some((u) => u.id === currentUserId) ? currentUserId : "" }));
  }, [meta, users, values, currentUserId]);

  useEffect(() => {
    fetch("/api/v1/crm/contacts/company-options")
      .then((r) => (r.ok ? r.json() : { data: { companies: [], customers: null } }))
      .then((b) => setOptions(b.data ?? { companies: [], customers: null }))
      .catch(() => {});
  }, []);

  const companyOptions = useMemo(() => {
    const list: { id: string; label: string; sublabel?: string }[] = options.companies.map((c) => ({ id: `co:${c.id}`, label: c.name, sublabel: [c.customerId ? "ERP customer" : "CRM company", c.city, c.country].filter(Boolean).join(" · ") }));
    if (contact?.crmCompany && !options.companies.some((c) => c.id === contact.crmCompany!.id)) list.unshift({ id: `co:${contact.crmCompany.id}`, label: contact.crmCompany.name, sublabel: "Current company" });
    if (!contact && initialCompany && !list.some((o) => o.id === `co:${initialCompany.id}`)) list.unshift({ id: `co:${initialCompany.id}`, label: initialCompany.name, sublabel: "CRM company" });
    for (const cu of options.customers ?? []) {
      if (cu.crmCompanyId && list.some((o) => o.id === `co:${cu.crmCompanyId}`)) continue;
      list.push({ id: `cu:${cu.id}`, label: cu.name, sublabel: ["ERP customer", cu.code, cu.city, cu.country].filter(Boolean).join(" · ") });
    }
    return list;
  }, [options, contact, initialCompany]);

  const crmCompanyIdForDup = company.startsWith("co:") ? company.slice(3) : null;
  const dupKey = values ? [...DUP_KEYS.map((k) => values[k]), crmCompanyIdForDup].join("|") : "";
  useEffect(() => {
    const hasDetail = values ? ["email", "alternateEmail", "phone", "mobile", "whatsapp"].some((k) => values[k].trim()) : false;
    if (!values || (!hasDetail && !(values.firstName.trim() && crmCompanyIdForDup))) {
      setLiveMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const body = { ...Object.fromEntries(DUP_KEYS.map((k) => [k, values[k] || null])), crmCompanyId: crmCompanyIdForDup, excludeContactId: contact?.id ?? null };
      const res = await crmRequest<{ matches: ContactDuplicateMatchDto[] }>("/api/v1/crm/contacts/duplicate-check", { method: "POST", body, toast: "off" });
      if (res.ok) setLiveMatches(res.data.matches);
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupKey, contact?.id]);

  const sourceOptions = useMemo(() => (meta?.sources ?? []).filter((s) => s.isActive !== false || s.id === contact?.sourceId), [meta, contact?.sourceId]);
  const ownerOptions = useMemo(() => {
    const opts = users.map((u) => ({ id: u.id, label: u.fullName }));
    if (contact?.owner && !opts.some((o) => o.id === contact.owner!.id)) opts.unshift({ id: contact.owner.id, label: `${contact.owner.fullName} (inactive)` });
    return opts;
  }, [users, contact?.owner]);

  if (lookupError) return <CrmErrorState message={lookupError} onRetry={reload} />;
  if (!meta || !values) return <CrmLoadingState />;

  const set = (k: string, v: string) => setValues((prev) => ({ ...(prev as Values), [k]: v }));
  const err = (k: string) => fieldErrors[k];
  const input = (k: (typeof TEXT_KEYS)[number], props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input id={`contact-${k}`} className={textInputClass(Boolean(err(k)))} value={values[k]} onChange={(e) => set(k, e.target.value)} {...props} />
  );
  const suggest = (k: "designation" | "department" | "relationshipRole", list: string[]) => (
    <>
      {input(k, { maxLength: 100, list: `contact-${k}-options` })}
      <datalist id={`contact-${k}-options`}>
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
    payload.firstName = values.firstName;
    payload.customFields = customFields;
    if (company.startsWith("cu:")) {
      payload.customerId = company.slice(3);
      if (!contact) payload.crmCompanyId = null;
    } else payload.crmCompanyId = company ? company.slice(3) : null;
    if (confirmDuplicate) payload.confirmDuplicate = true;
    if (contact) payload.version = contact.version;
    else {
      payload.tagIds = tags.filter((t) => t.id).map((t) => t.id);
      payload.tagNames = tags.filter((t) => !t.id).map((t) => t.name);
      if (address.line1.trim()) payload.addresses = [{ ...Object.fromEntries(ADDRESS_KEYS.map((k) => [k, address[k] || null])), addressType: address.addressType, line1: address.line1, isPrimary: true }];
    }

    const res = await crmRequest<{ id: string }>(contact ? `/api/v1/crm/contacts/${contact.id}` : "/api/v1/crm/contacts", { method: contact ? "PATCH" : "POST", body: payload, toast: "off" });
    setBusy(false);
    if (res.ok) {
      toast.success(contact ? "Contact updated." : "Contact created.");
      router.push(`/crm/contacts/${contact?.id ?? res.data.id}`);
      router.refresh();
      return;
    }
    const e = res.error;
    if (e.code === "CRM_POSSIBLE_DUPLICATE" || (e.code === "CRM_DUPLICATE_RECORD" && e.details?.entityType === "CONTACT")) {
      setSaveMatches({ matches: (e.details?.matches as ContactDuplicateMatchDto[]) ?? [], mode: e.details?.blocking ? "block" : "warn" });
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
      <section className={section}>
        <h2 className={heading}>Person</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="First name" htmlFor="contact-firstName" required error={err("firstName")}>
            {input("firstName", { maxLength: 100, autoFocus: !contact })}
          </FormField>
          <FormField label="Middle name" htmlFor="contact-middleName" error={err("middleName")}>
            {input("middleName", { maxLength: 100 })}
          </FormField>
          <FormField label="Last name" htmlFor="contact-lastName" error={err("lastName")}>
            {input("lastName", { maxLength: 100 })}
          </FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className={heading}>Company & role</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Company" htmlFor="contact-company" error={err("crmCompanyId") ?? err("customerId")}>
            <SearchableSelect id="contact-company" value={company} onChange={setCompany} options={companyOptions} placeholder="Search CRM companies and ERP customers…" emptyOptionLabel="— No company —" />
          </FormField>
          <FormField label="Designation" htmlFor="contact-designation" error={err("designation")}>
            {suggest("designation", meta.suggestions.contact_designation ?? [])}
          </FormField>
          <FormField label="Department" htmlFor="contact-department" error={err("department")}>
            {suggest("department", meta.suggestions.contact_department ?? [])}
          </FormField>
          <FormField label="Relationship role" htmlFor="contact-relationshipRole" error={err("relationshipRole")}>
            {suggest("relationshipRole", meta.suggestions.contact_role ?? [])}
          </FormField>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {meta.canPickCustomer ? "Picking an ERP customer links this contact to that customer's CRM company (created if needed); no customer data is copied." : "Only CRM companies are listed. ERP customers appear here for users who can view customers."}
        </p>
      </section>

      <section className={section}>
        <h2 className={heading}>Contact details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Email" htmlFor="contact-email" error={err("email")}>
            {input("email", { type: "email", maxLength: 200 })}
          </FormField>
          <FormField label="Alternate email" htmlFor="contact-alternateEmail" error={err("alternateEmail")}>
            {input("alternateEmail", { type: "email", maxLength: 200 })}
          </FormField>
          <FormField label="Mobile" htmlFor="contact-mobile" error={err("mobile")}>
            {input("mobile", { type: "tel", maxLength: 30 })}
          </FormField>
          <FormField label="Phone" htmlFor="contact-phone" error={err("phone")}>
            {input("phone", { type: "tel", maxLength: 30, placeholder: "Office / landline" })}
          </FormField>
          <FormField label="WhatsApp" htmlFor="contact-whatsapp" error={err("whatsapp")}>
            {input("whatsapp", { type: "tel", maxLength: 30, placeholder: "Include country code, e.g. +91…" })}
          </FormField>
        </div>
        {contact && <p className="text-xs text-zinc-500 dark:text-zinc-400">More emails, numbers and links can be added from the contact page.</p>}
        <DuplicatePanel matches={saveMatches ? [] : liveMatches} mode="live" />
      </section>

      <section className={section}>
        <h2 className={heading}>Ownership</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Owner" htmlFor="contact-ownerUserId" error={err("ownerUserId")}>
            <SearchableSelect id="contact-ownerUserId" value={values.ownerUserId} onChange={(v) => set("ownerUserId", v)} options={ownerOptions} placeholder="Search people…" emptyOptionLabel="— Unassigned —" />
          </FormField>
          <FormField label="Source" htmlFor="contact-sourceId" error={err("sourceId")}>
            <select id="contact-sourceId" className={textInputClass(Boolean(err("sourceId")))} value={values.sourceId} onChange={(e) => set("sourceId", e.target.value)}>
              <option value="">— None —</option>
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </section>

      {!contact && (
        <section className={section}>
          <h2 className={heading}>Primary address (optional)</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Type" htmlFor="contact-addr-type">
              <select id="contact-addr-type" className={textInputClass()} value={address.addressType} onChange={(e) => setAddress((a) => ({ ...a, addressType: e.target.value }))}>
                {Object.entries(ADDRESS_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="Address line 1" htmlFor="contact-addr-line1" error={err("addresses.0.line1")}>
                <input id="contact-addr-line1" className={textInputClass()} value={address.line1} maxLength={200} onChange={(e) => setAddress((a) => ({ ...a, line1: e.target.value }))} />
              </FormField>
            </div>
            {(["line2", "city", "state", "postalCode"] as const).map((k) => (
              <FormField key={k} label={{ line2: "Address line 2", city: "City", state: "State / region", postalCode: "Postal code" }[k]} htmlFor={`contact-addr-${k}`}>
                <input id={`contact-addr-${k}`} className={textInputClass()} value={address[k]} maxLength={k === "postalCode" ? 20 : 200} onChange={(e) => setAddress((a) => ({ ...a, [k]: e.target.value }))} />
              </FormField>
            ))}
            <FormField label="Country" htmlFor="contact-addr-country">
              <SearchableSelect id="contact-addr-country" value={address.country} onChange={(v) => setAddress((a) => ({ ...a, country: v }))} options={COUNTRIES.map((c) => ({ id: c, label: c }))} placeholder="Search countries…" emptyOptionLabel="—" />
            </FormField>
          </div>
        </section>
      )}

      {!contact && (
        <section className={section}>
          <h2 className={heading}>Tags</h2>
          <CrmTagInput id="contact-tags" value={tags} onChange={setTags} />
        </section>
      )}

      {meta.customFields.some((d) => d.isActive) && (
        <section className={section}>
          <h2 className={heading}>Additional information</h2>
          <CrmCustomFieldInputs definitions={meta.customFields} values={customFields} onChange={(k, v) => setCustomFields((c) => ({ ...c, [k]: v }))} errors={fieldErrors} />
        </section>
      )}

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
          {contact ? "Save changes" : "Create contact"}
        </Button>
        <Button variant="secondary" onClick={() => router.push(contact ? `/crm/contacts/${contact.id}` : "/crm/contacts")} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmDrawer } from "@/components/crm/CrmDrawer";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { LeadDetailDto } from "./lead-types";

interface CompanyOption {
  id: string;
  name: string;
  city?: string | null;
  country?: string | null;
}
interface ContactOption {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  crmCompany?: { name: string } | null;
}
interface Suggestions {
  companyMatches: CompanyOption[];
  contactMatches: ContactOption[];
}
type Mode = "none" | "link" | "create";

function useLookup<T>(url: string, term: string) {
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      fetch(`${url}?search=${encodeURIComponent(term)}`, { signal: c.signal })
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => setRows(b.data ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [url, term]);
  return rows;
}

function Choice({ name, value, current, onSelect, label, hint }: { name: string; value: Mode; current: Mode; onSelect: (m: Mode) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-200">
      <input type="radio" name={name} checked={current === value} onChange={() => onSelect(value)} className="mt-0.5" />
      <span>
        {label}
        {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Lead conversion: create or link a Company and a Contact (at least one) and
 * optionally create an Opportunity, in one transaction. Existing matches are
 * shown first and linking them is preferred, so conversion never silently
 * duplicates a company or contact.
 */
export function ConvertLeadDrawer({ open, onClose, lead, onDone }: { open: boolean; onClose: () => void; lead: LeadDetailDto; onDone: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companyMode, setCompanyMode] = useState<Mode>(lead.crmCompanyId ? "link" : lead.companyName ? "create" : "none");
  const [companyId, setCompanyId] = useState(lead.crmCompanyId ?? "");
  const [companyName, setCompanyName] = useState(lead.companyName ?? "");
  const [allowDuplicate, setAllowDuplicate] = useState<{ COMPANY?: boolean; CONTACT?: boolean }>({});
  const [contactMode, setContactMode] = useState<Mode>(lead.crmContactId ? "link" : "create");
  const [contactId, setContactId] = useState(lead.crmContactId ?? "");
  const [createOpp, setCreateOpp] = useState(true);
  const [oppName, setOppName] = useState([lead.companyName, lead.fullName].filter(Boolean).join(" — "));
  const [oppAmount, setOppAmount] = useState(lead.estimatedValue ?? "");
  const [oppClose, setOppClose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ entityType: "COMPANY" | "CONTACT"; matches: (CompanyOption & ContactOption)[]; blocking?: boolean } | null>(null);
  const companyLookup = useLookup<CompanyOption>("/api/v1/crm/companies/lookup", "");
  const contactLookup = useLookup<ContactOption>("/api/v1/crm/contacts/lookup", "");

  useEffect(() => {
    if (!open) return;
    crmRequest<Suggestions>(`/api/v1/crm/leads/${lead.id}/convert`).then((res) => {
      if (!res.ok) return setLoadError(res.error.message);
      setSuggestions(res.data);
      if (!lead.crmCompanyId && res.data.companyMatches.length) {
        setCompanyMode("link");
        setCompanyId(res.data.companyMatches[0].id);
      }
      if (!lead.crmContactId && res.data.contactMatches.length) {
        setContactMode("link");
        setContactId(res.data.contactMatches[0].id);
      }
    });
  }, [open, lead.id, lead.crmCompanyId, lead.crmContactId]);

  const companyOptions = [...new Map([...(suggestions?.companyMatches ?? []), ...companyLookup].map((c) => [c.id, c])).values()];
  const contactOptions = [...new Map([...(suggestions?.contactMatches ?? []), ...contactLookup].map((c) => [c.id, c])).values()];

  const submit = async (allow?: "COMPANY" | "CONTACT") => {
    setError(null);
    const allowed = allow ? { ...allowDuplicate, [allow]: true } : allowDuplicate;
    if (allow) setAllowDuplicate(allowed);
    if (companyMode === "none" && contactMode === "none") return setError("Choose at least a contact or a company.");
    if (companyMode === "link" && !companyId) return setError("Pick the company to link.");
    if (contactMode === "link" && !contactId) return setError("Pick the contact to link.");
    if (companyMode === "create" && !companyName.trim()) return setError("Enter the company name.");
    if (createOpp && !oppName.trim()) return setError("Enter the opportunity name.");
    setBusy(true);
    const body = {
      version: lead.version,
      company:
        companyMode === "none"
          ? { mode: "none" }
          : companyMode === "link"
            ? { mode: "link", id: companyId }
            : { mode: "create", name: companyName, allowDuplicate: allowed.COMPANY || undefined },
      contact: contactMode === "none" ? { mode: "none" } : contactMode === "link" ? { mode: "link", id: contactId } : { mode: "create", allowDuplicate: allowed.CONTACT || undefined },
      opportunity: createOpp ? { create: true, name: oppName, amount: oppAmount === "" ? null : Number(oppAmount), currencyCode: lead.currencyCode, expectedCloseDate: oppClose || null } : { create: false },
    };
    const res = await crmRequest(`/api/v1/crm/leads/${lead.id}/convert`, { method: "POST", body, toast: "off" });
    setBusy(false);
    if (res.ok) {
      const { toast } = await import("@/components/ui/Toast");
      toast.success("Lead converted.");
      return onDone();
    }
    if (res.error.code === "CRM_DUPLICATE_RECORD" && res.error.details) {
      setDuplicate({
        entityType: res.error.details.entityType as "COMPANY" | "CONTACT",
        matches: (res.error.details.matches as (CompanyOption & ContactOption)[]) ?? [],
        blocking: Boolean(res.error.details.blocking),
      });
    } else {
      setDuplicate(null);
    }

    setError(res.error.message);
  };

  const linkMatch = (id: string) => {
    if (duplicate?.entityType === "COMPANY") {
      setCompanyMode("link");
      setCompanyId(id);
    } else {
      setContactMode("link");
      setContactId(id);
    }
    setDuplicate(null);
    setError(null);
  };

  return (
    <CrmDrawer
      open={open}
      onClose={onClose}
      title={`Convert ${lead.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => submit()} isLoading={busy} loadingLabel="Converting…" disabled={!suggestions}>
            Convert lead
          </Button>
        </>
      }
    >
      {loadError ? (
        <CrmErrorState message={loadError} />
      ) : !suggestions ? (
        <CrmLoadingState />
      ) : (
        <div className="space-y-6">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Company</h3>
            {suggestions.companyMatches.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {suggestions.companyMatches.length} existing compan{suggestions.companyMatches.length === 1 ? "y matches" : "ies match"} “{lead.companyName}”. Linking avoids a duplicate.
              </p>
            )}
            <Choice name="company" value="link" current={companyMode} onSelect={setCompanyMode} label="Link an existing company" />
            {companyMode === "link" && (
              <div className="ml-6">
                <SearchableSelect
                  id="convert-company"
                  value={companyId}
                  onChange={(v) => setCompanyId(v)}
                  options={companyOptions.map((c) => ({ id: c.id, label: c.name, sublabel: [c.city, c.country].filter(Boolean).join(", ") || undefined }))}
                  placeholder="Search companies…"
                  emptyOptionLabel={null}
                />

              </div>
            )}
            <Choice name="company" value="create" current={companyMode} onSelect={setCompanyMode} label="Create a new company" />
            {companyMode === "create" && (
              <div className="ml-6">
                <input aria-label="New company name" className={textInputClass()} value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} />
              </div>
            )}
            <Choice name="company" value="none" current={companyMode} onSelect={setCompanyMode} label="No company" hint="Contact only." />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Contact</h3>
            {suggestions.contactMatches.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {suggestions.contactMatches.length} existing contact(s) share this lead’s email or phone. Linking avoids a duplicate.
              </p>
            )}
            <Choice name="contact" value="create" current={contactMode} onSelect={setContactMode} label={`Create contact “${lead.fullName}”`} hint={[lead.email, lead.phone ?? lead.mobile].filter(Boolean).join(" · ") || undefined} />
            <Choice name="contact" value="link" current={contactMode} onSelect={setContactMode} label="Link an existing contact" />
            {contactMode === "link" && (
              <div className="ml-6">
                <SearchableSelect
                  id="convert-contact"
                  value={contactId}
                  onChange={setContactId}
                  options={contactOptions.map((c) => ({ id: c.id, label: c.fullName, sublabel: [c.email, c.phone, c.crmCompany?.name].filter(Boolean).join(" · ") || undefined }))}
                  placeholder="Search contacts…"
                  emptyOptionLabel={null}
                />
              </div>
            )}
            <Choice name="contact" value="none" current={contactMode} onSelect={setContactMode} label="No contact" hint="Company only." />
          </section>

          <section className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              <input type="checkbox" checked={createOpp} onChange={(e) => setCreateOpp(e.target.checked)} />
              Create an opportunity
            </label>
            {createOpp && (
              <div className="space-y-3">
                <FormField label="Opportunity name" htmlFor="convert-opp-name" required>
                  <input id="convert-opp-name" className={textInputClass()} value={oppName} onChange={(e) => setOppName(e.target.value)} maxLength={200} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={`Amount${lead.currencyCode ? ` (${lead.currencyCode})` : ""}`} htmlFor="convert-opp-amount">
                    <input id="convert-opp-amount" type="number" min={0} step="0.01" className={textInputClass()} value={oppAmount} onChange={(e) => setOppAmount(e.target.value)} />
                  </FormField>
                  <FormField label="Expected close" htmlFor="convert-opp-close">
                    <input id="convert-opp-close" type="date" className={textInputClass()} value={oppClose} onChange={(e) => setOppClose(e.target.value)} />
                  </FormField>
                </div>
              </div>
            )}
          </section>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {duplicate && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="font-medium text-amber-900 dark:text-amber-200">Existing {duplicate.entityType === "COMPANY" ? "company" : "contact"}:</p>
              <ul className="mt-1 space-y-1">
                {duplicate.matches.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <span className="text-amber-900 dark:text-amber-100">{m.name ?? m.fullName}</span>
                    <button type="button" className="text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => linkMatch(m.id)}>
                      Link this instead
                    </button>
                  </li>
                ))}
              </ul>
              {duplicate.blocking ? (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">Your duplicate rules don&apos;t allow another one — link the existing record.</p>
              ) : (
                <button type="button" className="mt-2 text-xs text-amber-800 underline dark:text-amber-300" onClick={() => submit(duplicate.entityType)}>
                  Create a new one anyway
                </button>
              )}
            </div>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">The lead is kept and marked Converted; its timeline, notes and tags stay intact.</p>
        </div>
      )}
    </CrmDrawer>
  );
}

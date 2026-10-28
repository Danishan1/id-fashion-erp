"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { SALES_ENQUIRY_PRIORITIES, SALES_ENQUIRY_PRIORITY_KEYS, type SalesEnquiryPriority } from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";

interface CrmCompanyOption {
  id: string;
  name: string;
  city: string | null;
  customerId: string | null;
}
interface CrmContactOption {
  id: string;
  fullName: string;
  email: string | null;
  crmCompanyId: string | null;
}
export interface OwnerOption {
  id: string;
  fullName: string;
}

/** Users who can own an enquiry (active, with Sales & Marketing access). */
export function useEnquiryOwners(enabled = true) {
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  useEffect(() => {
    if (!enabled) return;
    fetch("/api/v1/sales-marketing/owners", { headers: { "x-toast": "off" } })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((body) => setOwners(body.data ?? []));
  }, [enabled]);
  return owners;
}

/**
 * CRM company + contact pickers, fed by the CRM's own lookup endpoints (so the
 * user only sees CRM records they can see in the CRM). Picking a company narrows
 * the contacts to that company; the server re-checks everything.
 */
export function CrmLinkFields({
  crmCompanyId,
  crmContactId,
  onChange,
  initialCompany,
  initialContact,
}: {
  crmCompanyId: string;
  crmContactId: string;
  onChange: (next: { crmCompanyId: string; crmContactId: string }) => void;
  initialCompany?: { id: string; name: string } | null;
  initialContact?: { id: string; fullName: string } | null;
}) {
  const [companies, setCompanies] = useState<CrmCompanyOption[]>([]);
  const [contacts, setContacts] = useState<CrmContactOption[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const opts = { headers: { "x-toast": "off" } };
    Promise.all([fetch("/api/v1/crm/companies/lookup?limit=200", opts), fetch("/api/v1/crm/contacts/lookup?limit=200", opts)]).then(async ([a, b]) => {
      if (!a.ok || !b.ok) {
        setUnavailable(true);
        return;
      }
      setCompanies((await a.json()).data ?? []);
      setContacts((await b.json()).data ?? []);
    });
  }, []);

  if (unavailable) {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">CRM links need CRM access.</p>;
  }

  const companyOptions = companies.map((c) => ({ id: c.id, label: c.name, sublabel: c.city ?? undefined }));
  if (initialCompany && !companies.some((c) => c.id === initialCompany.id)) companyOptions.unshift({ id: initialCompany.id, label: initialCompany.name, sublabel: undefined });
  const contactOptions = contacts
    .filter((c) => !crmCompanyId || !c.crmCompanyId || c.crmCompanyId === crmCompanyId)
    .map((c) => ({ id: c.id, label: c.fullName, sublabel: c.email ?? undefined }));
  if (initialContact && !contacts.some((c) => c.id === initialContact.id)) contactOptions.unshift({ id: initialContact.id, label: initialContact.fullName, sublabel: undefined });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="CRM company" htmlFor="crmCompanyId">
        <SearchableSelect
          id="crmCompanyId"
          value={crmCompanyId}
          onChange={(id) => {
            const contact = contacts.find((c) => c.id === crmContactId);
            const keepContact = !id || !contact?.crmCompanyId || contact.crmCompanyId === id;
            onChange({ crmCompanyId: id, crmContactId: keepContact ? crmContactId : "" });
          }}
          options={companyOptions}
          placeholder="Search CRM company…"
        />
      </FormField>
      <FormField label="CRM contact" htmlFor="crmContactId">
        <SearchableSelect
          id="crmContactId"
          value={crmContactId}
          onChange={(id) => onChange({ crmCompanyId, crmContactId: id })}
          options={contactOptions}
          placeholder="Search CRM contact…"
        />
      </FormField>
    </div>
  );
}

export function PrioritySelect({ id = "priority", value, onChange }: { id?: string; value: SalesEnquiryPriority; onChange: (v: SalesEnquiryPriority) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as SalesEnquiryPriority)} className={textInputClass()}>
      {SALES_ENQUIRY_PRIORITY_KEYS.map((p) => (
        <option key={p} value={p}>
          {SALES_ENQUIRY_PRIORITIES[p].label}
        </option>
      ))}
    </select>
  );
}

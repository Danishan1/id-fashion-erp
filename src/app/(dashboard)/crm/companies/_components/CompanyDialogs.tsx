"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import type { BulkResult } from "@/components/crm/CrmRecordDialogs";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import type { CompanyStatusDto, CustomerOptionDto } from "./company-types";

const API = "/api/v1/crm/companies";

function ErrorLine({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-red-600 dark:text-red-400">{message}</p> : null;
}

function Footer({ onCancel, busy, label, disabled }: { onCancel: () => void; busy: boolean; label: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" isLoading={busy} loadingLabel="Saving…" disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

/** Debounced server-side search used by the pickers below. */
function useRemoteSearch<T>(buildUrl: (term: string) => string, enabled = true) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const t = setTimeout(() => {
      crmRequest<T[]>(buildUrl(term.trim())).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows(res.data);
          setError(null);
        } else setError(res.error.message);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // buildUrl is a stable inline formatter; only the term drives refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, enabled]);
  return { term, setTerm, rows, error };
}

function PickList<T extends { id: string }>({
  rows,
  selectedId,
  onPick,
  render,
  isDisabled,
  empty,
}: {
  rows: T[] | null;
  selectedId: string | null;
  onPick: (row: T) => void;
  render: (row: T) => React.ReactNode;
  isDisabled?: (row: T) => string | null;
  empty: string;
}) {
  if (!rows) return <p className="text-sm text-zinc-500">Searching…</p>;
  if (rows.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>;
  return (
    <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
      {rows.map((r) => {
        const why = isDisabled?.(r) ?? null;
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              disabled={Boolean(why)}
              onClick={() => onPick(r)}
              className={`block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"}`}
              aria-pressed={selected}
            >
              {render(r)}
              {why && <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">{why}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Change the status of one company (recordId + version) or many (ids → bulk). */
export function ChangeCompanyStatusModal({
  statuses,
  target,
  currentStatusId,
  onClose,
  onDone,
}: {
  statuses: CompanyStatusDto[];
  target: { recordId: string; version?: number } | { ids: string[] };
  currentStatusId?: string | null;
  onClose: () => void;
  onDone: (result?: BulkResult) => void;
}) {
  const active = statuses.filter((s) => s.isActive !== false);
  const [statusId, setStatusId] = useState(currentStatusId && active.some((s) => s.id === currentStatusId) ? currentStatusId : (active[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusId) return setError("Choose a status.");
    setBusy(true);
    setError(null);
    if ("ids" in target) {
      const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "status", ids: target.ids, statusId }, toast: "errors" });
      setBusy(false);
      if (!res.ok) return setError(res.error.message);
      return onDone(res.data);
    }
    const res = await crmRequest(`${API}/${target.recordId}/status`, { method: "POST", body: { statusId, version: target.version }, successMessage: "Status updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={"ids" in target ? `Change status of ${target.ids.length} company(ies)` : "Change status"} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Status" htmlFor="company-status" required>
          <select id="company-status" className={textInputClass()} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Save" disabled={!statusId || (!("ids" in target) && statusId === currentStatusId)} />
      </form>
    </Modal>
  );
}

/**
 * Link an existing ERP customer. The ERP customer master is never edited here:
 * the CRM company only stores a reference. Customers already linked to another
 * CRM company can't be picked (merge the companies instead).
 */
export function LinkErpCustomerModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const search = useRemoteSearch<CustomerOptionDto>((t) => `${API}/customers?limit=20${t ? `&search=${encodeURIComponent(t)}` : ""}`);
  const [picked, setPicked] = useState<CustomerOptionDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return setError("Pick a customer.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${API}/${companyId}/erp-customer`, { method: "POST", body: { customerId: picked.id }, toast: "errors", successMessage: "ERP customer linked." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Link ERP customer" maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">The ERP customer stays the master record for billing, orders and balances. Linking only lets this company show its ERP documents.</p>
        <FormField label="Search customers" htmlFor="erp-customer-search">
          <input id="erp-customer-search" className={textInputClass()} value={search.term} onChange={(e) => search.setTerm(e.target.value)} placeholder="Name or code" autoFocus />
        </FormField>
        {search.error ? (
          <ErrorLine message={search.error} />
        ) : (
          <PickList
            rows={search.rows}
            selectedId={picked?.id ?? null}
            onPick={setPicked}
            empty="No customers match."
            isDisabled={(c) => (c.crmCompanyId && c.crmCompanyId !== companyId ? `Already linked to ${c.linkedCompany?.name ?? "another CRM company"}` : c.crmCompanyId === companyId ? "Already linked to this company" : null)}
            render={(c) => (
              <>
                <span className="font-medium">{c.name}</span> <span className="text-xs text-zinc-500">{[c.code, c.city, c.country, c.isActive ? null : "Inactive"].filter(Boolean).join(" · ")}</span>
              </>
            )}
          />
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Link customer" disabled={!picked} />
      </form>
    </Modal>
  );
}

interface ContactOption {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  crmCompanyId: string | null;
  crmCompany: { id: string; name: string } | null;
}

/** Add an existing contact to the company (or open the contact form to create one). */
export function AddCompanyContactModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const search = useRemoteSearch<ContactOption>((t) => `/api/v1/crm/contacts/lookup?limit=20${t ? `&search=${encodeURIComponent(t)}` : ""}`);
  const [picked, setPicked] = useState<ContactOption | null>(null);
  const [makePrimary, setMakePrimary] = useState(false);
  const [confirmMove, setConfirmMove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (c: ContactOption) => {
    setPicked(c);
    setConfirmMove(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return setError("Pick a contact.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${API}/${companyId}/contacts`, {
      method: "POST",
      body: { contactId: picked.id, makePrimary, moveFromOtherCompany: confirmMove !== null },
      toast: "off",
    });
    setBusy(false);
    if (!res.ok) {
      if (res.error.details?.needsConfirmation) return setConfirmMove(String(res.error.details.fromCompanyName ?? "another company"));
      return setError(res.error.message);
    }
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Add contact" maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Search contacts" htmlFor="company-contact-search">
          <input id="company-contact-search" className={textInputClass()} value={search.term} onChange={(e) => search.setTerm(e.target.value)} placeholder="Name, email or phone" autoFocus />
        </FormField>
        {search.error ? (
          <ErrorLine message={search.error} />
        ) : (
          <PickList
            rows={search.rows}
            selectedId={picked?.id ?? null}
            onPick={pick}
            empty="No contacts match."
            isDisabled={(c) => (c.crmCompanyId === companyId ? "Already at this company" : null)}
            render={(c) => (
              <>
                <span className="font-medium">{c.fullName}</span>{" "}
                <span className="text-xs text-zinc-500">{[c.email, c.mobile ?? c.phone, c.crmCompany ? `at ${c.crmCompany.name}` : null].filter(Boolean).join(" · ")}</span>
              </>
            )}
          />
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={makePrimary} onChange={(e) => setMakePrimary(e.target.checked)} /> Make primary contact
        </label>
        {confirmMove && (
          <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            {picked?.fullName} is currently at {confirmMove}. A contact belongs to one company — saving again moves them here.
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Not in the list?{" "}
          <Link href={`/crm/contacts/new?companyId=${companyId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            Create a new contact
          </Link>{" "}
          for this company.
        </p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={confirmMove ? "Move contact here" : "Add contact"} disabled={!picked} />
      </form>
    </Modal>
  );
}

interface LeadOption {
  id: string;
  leadNumber: string;
  fullName: string;
  companyName: string | null;
  crmCompany: { id: string; name: string } | null;
  convertedAt: string | null;
}

/** Associate an existing (visible, not archived) lead with the company. */
export function AssociateLeadModal({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const search = useRemoteSearch<LeadOption>((t) => `/api/v1/crm/leads?pageSize=20${t ? `&search=${encodeURIComponent(t)}` : ""}`);
  const [picked, setPicked] = useState<LeadOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return setError("Pick a lead.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${API}/${companyId}/leads`, { method: "POST", body: { leadId: picked.id }, toast: "errors", successMessage: "Lead associated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Associate lead" maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Search leads" htmlFor="company-lead-search">
          <input id="company-lead-search" className={textInputClass()} value={search.term} onChange={(e) => search.setTerm(e.target.value)} placeholder="Lead number, name, email or phone" autoFocus />
        </FormField>
        {search.error ? (
          <ErrorLine message={search.error} />
        ) : (
          <PickList
            rows={search.rows}
            selectedId={picked?.id ?? null}
            onPick={setPicked}
            empty="No leads match."
            isDisabled={(l) => (l.crmCompany?.id === companyId ? "Already associated" : null)}
            render={(l) => (
              <>
                <span className="font-medium">
                  {l.leadNumber} — {l.fullName}
                </span>{" "}
                <span className="text-xs text-zinc-500">{[l.crmCompany ? `linked to ${l.crmCompany.name}` : l.companyName, l.convertedAt ? "Converted" : null].filter(Boolean).join(" · ")}</span>
              </>
            )}
          />
        )}
        {picked?.crmCompany && picked.crmCompany.id !== companyId && <p className="text-xs text-amber-700 dark:text-amber-300">This lead is currently linked to {picked.crmCompany.name}; it will be re-linked here.</p>}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Associate" disabled={!picked} />
      </form>
    </Modal>
  );
}

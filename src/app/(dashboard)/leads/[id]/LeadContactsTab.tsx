"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { mailtoUrl, telUrl, whatsAppUrl } from "@/lib/communication";

interface Contact {
  id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  notes: string | null;
}

const EMPTY = { name: "", designation: "", email: "", phone: "", whatsappNumber: "", notes: "" };

interface Props {
  leadId: string;
  primary: { name: string; designation: string | null; email: string | null; phone: string | null; whatsappNumber: string | null };
}

function ContactLinks({ email, phone, whatsappNumber }: { email: string | null; phone: string | null; whatsappNumber: string | null }) {
  const tel = telUrl(phone);
  const mail = mailtoUrl(email);
  const wa = whatsAppUrl(whatsappNumber ?? phone);
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {tel && (
        <a href={tel} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Call {phone}
        </a>
      )}
      {mail && (
        <a href={mail} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          {email}
        </a>
      )}
      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="font-medium text-green-700 hover:underline dark:text-green-400">
          WhatsApp
        </a>
      )}
    </div>
  );
}

export function LeadContactsTab({ leadId, primary }: Props) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [values, setValues] = useState(EMPTY);
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/v1/leads/${leadId}/contacts`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setContacts(body.data ?? []))
      .catch(() => setError("Could not load contacts."));

  useEffect(() => {
    fetch(`/api/v1/leads/${leadId}/contacts`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body) => setContacts(body.data ?? []))
      .catch(() => setError("Could not load contacts."));
  }, [leadId]);

  const open = (c: Contact | "new") => {
    setError(null);
    setEditing(c);
    setValues(
      c === "new"
        ? EMPTY
        : {
            name: c.name,
            designation: c.designation ?? "",
            email: c.email ?? "",
            phone: c.phone ?? "",
            whatsappNumber: c.whatsappNumber ?? "",
            notes: c.notes ?? "",
          }
    );
  };

  const save = async () => {
    if (!editing) return;
    const res = await fetch(editing === "new" ? `/api/v1/leads/${leadId}/contacts` : `/api/v1/leads/contacts/${editing.id}`, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }).catch(() => null);
    if (!res || !res.ok) {
      const body = await res?.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save contact.");
      return;
    }
    setEditing(null);
    load();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await fetch(`/api/v1/leads/contacts/${pendingDelete.id}`, { method: "DELETE" }).catch(() => null);
    setPendingDelete(null);
    load();
  };

  const field = (key: keyof typeof EMPTY, label: string, type = "text") => (
    <FormField label={label} htmlFor={`contact-${key}`} required={key === "name"}>
      <input id={`contact-${key}`} type={type} value={values[key]} onChange={(e) => setValues((p) => ({ ...p, [key]: e.target.value }))} className={textInputClass()} />
    </FormField>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-sm dark:border-indigo-900 dark:bg-indigo-950/20">
        <div className="font-medium">
          {primary.name}
          {primary.designation ? <span className="font-normal text-zinc-500"> · {primary.designation}</span> : null}
          <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">PRIMARY</span>
        </div>
        <ContactLinks email={primary.email} phone={primary.phone} whatsappNumber={primary.whatsappNumber} />
      </div>

      {contacts === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        contacts.map((c) => (
          <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div>
              <div className="font-medium">
                {c.name}
                {c.designation ? <span className="font-normal text-zinc-500"> · {c.designation}</span> : null}
              </div>
              <ContactLinks email={c.email} phone={c.phone} whatsappNumber={c.whatsappNumber} />
              {c.notes && <p className="mt-1 text-xs text-zinc-500">{c.notes}</p>}
            </div>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => open(c)} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Edit
              </button>
              <button type="button" onClick={() => setPendingDelete(c)} className="font-medium text-red-600 hover:underline">
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      <button type="button" onClick={() => open("new")} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        + Add Contact
      </button>
      {error && !editing && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add Contact" : "Edit Contact"}>
        <div className="space-y-3">
          {field("name", "Name")}
          {field("designation", "Designation")}
          {field("email", "Email", "email")}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {field("phone", "Mobile", "tel")}
            {field("whatsappNumber", "WhatsApp (with country code)", "tel")}
          </div>
          {field("notes", "Notes")}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!values.name.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Save Contact
            </button>
          </div>
        </div>
      </Modal>
      <ConfirmModal
        open={!!pendingDelete}
        title="Remove contact"
        message={`Remove ${pendingDelete?.name} from this lead?`}
        confirmLabel="Remove"
        isDangerous
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

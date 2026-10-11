"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { toast } from "@/components/ui/Toast";
import { CONVERSATIONS_API, type ConversationDetailDto } from "./conversation-types";

export interface UserOption {
  id: string;
  fullName: string;
}

const businessToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Link / relink / unlink the contact, company and opportunity — existing CRM records only. */
export function LinkRecordsDialog({ conversation, onClose, onSaved }: { conversation: ConversationDetailDto; onClose: () => void; onSaved: (c: ConversationDetailDto) => void }) {
  const [contact, setContact] = useState<CrmPickedRecord | null>(conversation.contact ? { id: conversation.contact.id, label: conversation.contact.fullName } : null);
  const [company, setCompany] = useState<CrmPickedRecord | null>(conversation.company ? { id: conversation.company.id, label: conversation.company.name } : null);
  const [opportunity, setOpportunity] = useState<CrmPickedRecord | null>(conversation.opportunity ? { id: conversation.opportunity.id, label: conversation.opportunity.label } : null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const choices = conversation.opportunityChoices.filter((o) => o.id !== opportunity?.id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = { version: conversation.version };
    if ((contact?.id ?? null) !== (conversation.contact?.id ?? null)) body.contactId = contact?.id ?? null;
    if ((company?.id ?? null) !== (conversation.company?.id ?? null)) body.companyId = company?.id ?? null;
    if ((opportunity?.id ?? null) !== (conversation.opportunity?.id ?? null)) body.opportunityId = opportunity?.id ?? null;
    if (Object.keys(body).length === 1) return onClose();
    setBusy(true);
    setError(null);
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversation.id}/link`, { method: "POST", body, toast: "off" });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    toast.success("Links updated.");
    onSaved(res.data);
  };

  return (
    <Modal open onClose={onClose} title="Link to CRM records" maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Link this conversation to existing records. Linking a contact also fills its company. Nothing is created here.</p>
        <FormField label="Contact" htmlFor="link-contact" error={errors.contactId}>
          <CrmRecordPicker<{ id: string; fullName: string; email?: string | null; crmCompany?: { name: string } | null }>
            id="link-contact"
            lookupUrl="/api/v1/crm/contacts/lookup"
            value={contact}
            onChange={(r) => setContact(r)}
            toOption={(r) => ({ id: r.id, label: r.fullName, sublabel: r.crmCompany?.name ?? r.email ?? null })}
            placeholder="Search contacts by name, email or phone…"
          />
        </FormField>
        <FormField label="Company" htmlFor="link-company" error={errors.companyId}>
          <CrmRecordPicker<{ id: string; name: string; city?: string | null }> id="link-company" lookupUrl="/api/v1/crm/companies/lookup" value={company} onChange={(r) => setCompany(r)} toOption={(r) => ({ id: r.id, label: r.name, sublabel: r.city ?? null })} placeholder="Search companies…" />
        </FormField>
        <FormField label="Opportunity" htmlFor="link-opportunity" error={errors.opportunityId}>
          <CrmRecordPicker<{ id: string; name: string; opportunityNumber?: string }>
            id="link-opportunity"
            lookupUrl="/api/v1/crm/opportunities?pageSize=15"
            value={opportunity}
            onChange={(r) => setOpportunity(r)}
            toOption={(r) => ({ id: r.id, label: r.opportunityNumber ? `${r.opportunityNumber} — ${r.name}` : r.name })}
            placeholder="Search opportunities…"
          />
        </FormField>
        {choices.length > 0 && !opportunity && (
          <div>
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Open opportunities of this contact / company</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {choices.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setOpportunity({ id: o.id, label: o.label })} className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            Save links
          </Button>
        </div>
      </form>
    </Modal>
  );
}

interface DuplicateMatch {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Unmatched queue → new contact, pre-filled from the sender's identity.
 * The contact service's duplicate rules decide: matches are shown so the
 * user links the existing contact instead (or confirms when allowed).
 */
export function CreateContactDialog({ conversation, onClose, onSaved }: { conversation: ConversationDetailDto; onClose: () => void; onSaved: (c: ConversationDetailDto) => void }) {
  const customer = conversation.participants.find((p) => p.role === "CUSTOMER");
  const name = (customer?.displayName ?? conversation.displayName ?? "").trim();
  const [form, setForm] = useState({
    firstName: name.split(/\s+/)[0] ?? "",
    lastName: name.split(/\s+/).slice(1).join(" "),
    email: customer?.identifierKind === "EMAIL" ? (customer.identifier ?? "") : "",
    mobile: customer?.identifierKind === "PHONE" ? (customer.identifier ?? "") : "",
    whatsapp: customer?.identifierKind === "PHONE" && conversation.channel.channelType === "WHATSAPP" ? (customer.identifier ?? "") : "",
  });
  const [company, setCompany] = useState<CrmPickedRecord | null>(conversation.company ? { id: conversation.company.id, label: conversation.company.name } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<{ matches: DuplicateMatch[]; blocking: boolean } | null>(null);

  const save = async (confirmDuplicate = false) => {
    setBusy(true);
    setError(null);
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversation.id}/create-contact`, { method: "POST", body: { version: conversation.version, ...form, crmCompanyId: company?.id ?? null, confirmDuplicate }, toast: "off" });
    setBusy(false);
    if (res.ok) {
      toast.success("Contact created and linked.");
      return onSaved(res.data);
    }
    if (res.error.code === "CRM_POSSIBLE_DUPLICATE" || res.error.code === "CRM_DUPLICATE_RECORD") {
      return setDupes({ matches: (res.error.details?.matches as DuplicateMatch[]) ?? [], blocking: Boolean(res.error.details?.blocking) });
    }
    setErrors(res.error.fieldErrors);
    setError(res.error.message);
  };
  const linkExisting = async (contactId: string) => {
    setBusy(true);
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversation.id}/link`, { method: "POST", body: { version: conversation.version, contactId }, toast: "errors" });
    setBusy(false);
    if (res.ok) {
      toast.success("Linked to the existing contact.");
      onSaved(res.data);
    }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal open onClose={onClose} title="Create contact from conversation" maxWidthClass="max-w-lg">
      {dupes ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{dupes.blocking ? "A contact with these details already exists. Link it instead:" : "This looks like an existing contact. Link the right one, or create a new contact anyway:"}</p>
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {dupes.matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.fullName}</span>
                  <span className="block truncate text-xs text-zinc-500">{[m.companyName, m.email, m.phone].filter(Boolean).join(" · ")}</span>
                </span>
                <Button size="xs" onClick={() => linkExisting(m.id)} disabled={busy}>
                  Link this contact
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDupes(null)} disabled={busy}>
              Back
            </Button>
            {!dupes.blocking && (
              <Button variant="secondary" onClick={() => save(true)} isLoading={busy} loadingLabel="Creating…">
                Create anyway
              </Button>
            )}
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
          className="mt-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="First name" htmlFor="cc-first" required error={errors.firstName}>
              <input id="cc-first" className={textInputClass(Boolean(errors.firstName))} value={form.firstName} onChange={set("firstName")} required maxLength={100} autoFocus />
            </FormField>
            <FormField label="Last name" htmlFor="cc-last">
              <input id="cc-last" className={textInputClass()} value={form.lastName} onChange={set("lastName")} maxLength={100} />
            </FormField>
            <FormField label="Email" htmlFor="cc-email" error={errors.email}>
              <input id="cc-email" type="email" className={textInputClass(Boolean(errors.email))} value={form.email} onChange={set("email")} />
            </FormField>
            <FormField label="Mobile" htmlFor="cc-mobile" error={errors.mobile}>
              <input id="cc-mobile" className={textInputClass(Boolean(errors.mobile))} value={form.mobile} onChange={set("mobile")} />
            </FormField>
            <FormField label="WhatsApp" htmlFor="cc-wa" error={errors.whatsapp}>
              <input id="cc-wa" className={textInputClass(Boolean(errors.whatsapp))} value={form.whatsapp} onChange={set("whatsapp")} />
            </FormField>
            <FormField label="Company" htmlFor="cc-company">
              <CrmRecordPicker<{ id: string; name: string; city?: string | null }> id="cc-company" lookupUrl="/api/v1/crm/companies/lookup" value={company} onChange={(r) => setCompany(r)} toOption={(r) => ({ id: r.id, label: r.name, sublabel: r.city ?? null })} placeholder="Search companies…" />
            </FormField>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" isLoading={busy} loadingLabel="Checking…">
              Create and link
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** A Phase 09 task from the conversation (or one of its messages), linked to it and its records. */
export function ConversationTaskDialog({ conversation, messageId, quote, users, currentUserId, onClose, onSaved }: { conversation: ConversationDetailDto; messageId?: string; quote?: string; users: UserOption[]; currentUserId: string; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState(quote ? `Follow up: ${quote.slice(0, 80)}` : "");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(businessToday());
  const [dueTime, setDueTime] = useState("");
  const [assignee, setAssignee] = useState(conversation.assignedTo?.id ?? currentUserId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const target = conversation.opportunity?.label ?? conversation.contact?.fullName ?? conversation.company?.name ?? "this conversation";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${CONVERSATIONS_API}/${conversation.id}/tasks`, { method: "POST", body: { subject, description, dueDate, dueTime, assignedToUserId: assignee || null, ...(messageId ? { messageId } : {}) }, toast: "off" });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    toast.success("Task created.");
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title="Create task" maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The task is added to <span className="font-medium">{target}</span> and linked to this conversation{messageId ? " (the message is quoted in the task)" : ""}.
        </p>
        <FormField label="Subject" htmlFor="ct-subject" required error={errors.subject}>
          <input id="ct-subject" className={textInputClass(Boolean(errors.subject))} value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} autoFocus />
        </FormField>
        <FormField label="Details" htmlFor="ct-desc">
          <textarea id="ct-desc" className={textInputClass()} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </FormField>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Due date" htmlFor="ct-date" error={errors.dueDate}>
            <input id="ct-date" type="date" className={textInputClass()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Time" htmlFor="ct-time" error={errors.dueTime}>
            <input id="ct-time" type="time" className={textInputClass()} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </FormField>
          <FormField label="Assigned to" htmlFor="ct-assignee" error={errors.assignedToUserId}>
            <SearchableSelect id="ct-assignee" value={assignee} onChange={setAssignee} options={users.map((u) => ({ id: u.id, label: u.fullName }))} emptyOptionLabel="— Unassigned —" placeholder="Search people…" />
          </FormField>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            Create task
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Assign / reassign / unassign to an ERP user. */
export function AssignConversationDialog({ conversation, users, onClose, onSaved }: { conversation: ConversationDetailDto; users: UserOption[]; onClose: () => void; onSaved: (c: ConversationDetailDto) => void }) {
  const [assignee, setAssignee] = useState(conversation.assignedTo?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await crmRequest<ConversationDetailDto>(`${CONVERSATIONS_API}/${conversation.id}/assign`, { method: "POST", body: { version: conversation.version, assignedToUserId: assignee || null }, toast: "off" });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    toast.success(assignee ? "Conversation assigned." : "Conversation unassigned.");
    onSaved(res.data);
  };
  return (
    <Modal open onClose={onClose} title="Assign conversation">
      <form onSubmit={submit} className="mt-4 space-y-3">
        <FormField label="Assigned to" htmlFor="as-user">
          <SearchableSelect id="as-user" value={assignee} onChange={setAssignee} options={users.map((u) => ({ id: u.id, label: u.fullName }))} emptyOptionLabel="— Unassigned —" placeholder="Search people…" />
        </FormField>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

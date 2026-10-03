"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTagInput, type CrmTagChip } from "@/components/crm/CrmTagInput";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { COUNTRIES } from "@/lib/countries";
import {
  ADDRESS_TYPES,
  CONTACT_CHANNEL_TYPES,
  CONTACTABILITY_CHANNELS,
  CONTACTABILITY_SOURCES,
  CONTACTABILITY_STATUSES,
  USER_CONTACTABILITY_SOURCES,
  type ContactabilityChannel,
  type ContactabilityStatus,
} from "@/modules/crm/contacts/contact-registry";
import type { AddressDto, BulkResult, ConsentDto, TagDto, UserRefDto } from "./contact-types";

function ErrorLine({ message }: { message: string | null }) {
  return message ? <p className="text-sm text-red-600 dark:text-red-400">{message}</p> : null;
}

function Footer({ onCancel, busy, label, disabled, danger }: { onCancel: () => void; busy: boolean; label: string; disabled?: boolean; danger?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} isLoading={busy} loadingLabel="Saving…" disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

export function bulkMessage(r: BulkResult, verb: string) {
  return r.skipped.length ? `${verb} ${r.updated} of ${r.requested}. ${r.skipped.length} skipped.` : `${verb} ${r.updated} contact${r.updated === 1 ? "" : "s"}.`;
}

/** Assign one contact (contactId + version) or many (ids → bulk endpoint). */
export function AssignContactModal({
  onClose,
  users,
  target,
  currentOwnerId,
  onDone,
}: {
  onClose: () => void;
  users: UserRefDto[];
  target: { contactId: string; version?: number } | { ids: string[] };
  currentOwnerId?: string | null;
  onDone: (result?: BulkResult) => void;
}) {
  const [ownerId, setOwnerId] = useState(currentOwnerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bulk = "ids" in target;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = bulk
      ? await crmRequest<BulkResult>("/api/v1/crm/contacts/bulk", { method: "POST", body: { action: "assign", ids: target.ids, ownerUserId: ownerId || null }, toast: "errors" })
      : await crmRequest(`/api/v1/crm/contacts/${target.contactId}/assign`, { method: "POST", body: { ownerUserId: ownerId || null, version: target.version }, successMessage: "Owner updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  return (
    <Modal open onClose={onClose} title={bulk ? `Assign ${target.ids.length} contact(s)` : "Assign contact"}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Owner" htmlFor="assign-owner">
          <SearchableSelect id="assign-owner" value={ownerId} onChange={setOwnerId} options={users.map((u) => ({ id: u.id, label: u.fullName }))} placeholder="Search people…" emptyOptionLabel="— Unassigned —" />
        </FormField>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Assign" />
      </form>
    </Modal>
  );
}

/** Edit tags on one contact, or add / remove tags in bulk. */
export function ContactTagsModal({
  onClose,
  target,
  currentTags = [],
  mode = "edit",
  onDone,
}: {
  onClose: () => void;
  target: { contactId: string } | { ids: string[] };
  currentTags?: TagDto[];
  mode?: "edit" | "add" | "remove";
  onDone: (result?: BulkResult) => void;
}) {
  const [tags, setTags] = useState<CrmTagChip[]>(mode === "edit" ? currentTags : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bulk = "ids" in target;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let res;
    if (bulk) {
      const existing = tags.filter((t) => t.id).map((t) => t.id as string);
      res =
        mode === "remove"
          ? await crmRequest<BulkResult>("/api/v1/crm/contacts/bulk", { method: "POST", body: { action: "removeTags", ids: target.ids, tagIds: existing }, toast: "errors" })
          : await crmRequest<BulkResult>("/api/v1/crm/contacts/bulk", { method: "POST", body: { action: "addTags", ids: target.ids, tagIds: existing, tagNames: tags.filter((t) => !t.id).map((t) => t.name) }, toast: "errors" });
    } else {
      const before = new Set(currentTags.map((t) => t.id));
      const keep = new Set(tags.filter((t) => t.id).map((t) => t.id));
      const body = {
        addTagIds: tags.filter((t) => t.id && !before.has(t.id)).map((t) => t.id),
        addTagNames: tags.filter((t) => !t.id).map((t) => t.name),
        removeTagIds: currentTags.filter((t) => !keep.has(t.id)).map((t) => t.id),
      };
      if (!body.addTagIds.length && !body.addTagNames.length && !body.removeTagIds.length) {
        setBusy(false);
        return onClose();
      }
      res = await crmRequest(`/api/v1/crm/contacts/${target.contactId}/tags`, { method: "POST", body, successMessage: "Tags updated." });
    }
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  const title = bulk ? (mode === "remove" ? `Remove tags from ${target.ids.length} contact(s)` : `Add tags to ${target.ids.length} contact(s)`) : "Edit tags";
  return (
    <Modal open onClose={onClose} title={title} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Tags" htmlFor="contact-tags-input">
          <CrmTagInput id="contact-tags-input" value={tags} onChange={setTags} allowCreate={mode !== "remove"} />
        </FormField>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={mode === "remove" ? "Remove tags" : "Save tags"} disabled={bulk && tags.length === 0} />
      </form>
    </Modal>
  );
}

/** Set contactability (DND) for one channel or for all channels. */
export function ContactabilityModal({
  contactId,
  channel,
  current,
  onClose,
  onDone,
}: {
  contactId: string;
  channel: ContactabilityChannel;
  current: ConsentDto | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState<ContactabilityStatus>(current?.status ?? "DO_NOT_CONTACT");
  const [reason, setReason] = useState(current?.reason ?? "");
  const [source, setSource] = useState<string>(current && (USER_CONTACTABILITY_SOURCES as readonly string[]).includes(current.source) ? current.source : "MANUAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status !== "ALLOWED" && !reason.trim()) return setError("Give a reason so others know why.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`/api/v1/crm/contacts/${contactId}/contactability`, { method: "PUT", body: { channel, status, reason: reason || null, source }, successMessage: "Contactability saved." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={`Contactability — ${CONTACTABILITY_CHANNELS[channel]}`} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Status" htmlFor="consent-status" required>
          <select id="consent-status" className={textInputClass()} value={status} onChange={(e) => setStatus(e.target.value as ContactabilityStatus)}>
            {(Object.keys(CONTACTABILITY_STATUSES) as ContactabilityStatus[]).map((s) => (
              <option key={s} value={s}>
                {CONTACTABILITY_STATUSES[s]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Reason" htmlFor="consent-reason" required={status !== "ALLOWED"}>
          <textarea id="consent-reason" rows={3} maxLength={500} className={textInputClass()} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Asked not to be called; prefers email only" />
        </FormField>
        <FormField label="Source" htmlFor="consent-source">
          <select id="consent-source" className={textInputClass()} value={source} onChange={(e) => setSource(e.target.value)}>
            {USER_CONTACTABILITY_SOURCES.map((s) => (
              <option key={s} value={s}>
                {CONTACTABILITY_SOURCES[s]}
              </option>
            ))}
          </select>
        </FormField>
        {channel === "ALL" && status !== "ALLOWED" && <p className="text-xs text-amber-700 dark:text-amber-300">This blocks every channel, whatever each channel&apos;s own setting is.</p>}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Save" />
      </form>
    </Modal>
  );
}

const emptyAddress = { addressType: "OFFICE", label: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "", isPrimary: false };

/** Add or edit one address. */
export function AddressModal({ contactId, address, onClose, onDone }: { contactId: string; address: AddressDto | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(() =>
    address
      ? {
          addressType: address.addressType,
          label: address.label ?? "",
          line1: address.line1,
          line2: address.line2 ?? "",
          city: address.city ?? "",
          state: address.state ?? "",
          postalCode: address.postalCode ?? "",
          country: address.country ?? "",
          isPrimary: address.isPrimary,
        }
      : emptyAddress
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v, value: string | boolean) => setV((p) => ({ ...p, [k]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.line1.trim()) return setError("Address line 1 is required.");
    setBusy(true);
    setError(null);
    const body = { ...v, isPrimary: v.isPrimary || undefined };
    const res = address
      ? await crmRequest(`/api/v1/crm/contacts/${contactId}/addresses/${address.id}`, { method: "PATCH", body, successMessage: "Address updated." })
      : await crmRequest(`/api/v1/crm/contacts/${contactId}/addresses`, { method: "POST", body, successMessage: "Address added." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  const input = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <FormField label={label} htmlFor={`addr-${k}`} required={k === "line1"}>
      <input id={`addr-${k}`} className={textInputClass()} value={String(v[k])} onChange={(e) => set(k, e.target.value)} {...props} />
    </FormField>
  );

  return (
    <Modal open onClose={onClose} title={address ? "Edit address" : "Add address"} maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Type" htmlFor="addr-type">
            <select id="addr-type" className={textInputClass()} value={v.addressType} onChange={(e) => set("addressType", e.target.value)}>
              {Object.entries(ADDRESS_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          {input("label", "Label", { maxLength: 80, placeholder: "e.g. Head office" })}
        </div>
        {input("line1", "Address line 1", { maxLength: 200 })}
        {input("line2", "Address line 2", { maxLength: 200 })}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {input("city", "City", { maxLength: 100 })}
          {input("state", "State / region", { maxLength: 100 })}
          {input("postalCode", "Postal code", { maxLength: 20 })}
          <FormField label="Country" htmlFor="addr-country">
            <SearchableSelect id="addr-country" value={v.country} onChange={(c) => set("country", c)} options={COUNTRIES.map((c) => ({ id: c, label: c }))} placeholder="Search countries…" emptyOptionLabel="—" />
          </FormField>
        </div>
        {!address?.isPrimary && (
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            <input type="checkbox" checked={v.isPrimary} onChange={(e) => set("isPrimary", e.target.checked)} />
            Make this the primary address
          </label>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={address ? "Save address" : "Add address"} />
      </form>
    </Modal>
  );
}

/** Add an extra email / phone / social link. */
export function ChannelModal({ contactId, onClose, onDone }: { contactId: string; onClose: () => void; onDone: () => void }) {
  const [channelType, setChannelType] = useState("MOBILE");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError("Enter a value.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`/api/v1/crm/contacts/${contactId}/channels`, { method: "POST", body: { channelType, value, label: label || null }, successMessage: "Contact detail added." });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.value ?? res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Add contact detail" maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Type" htmlFor="ch-type">
            <select id="ch-type" className={textInputClass()} value={channelType} onChange={(e) => setChannelType(e.target.value)}>
              {Object.entries(CONTACT_CHANNEL_TYPES).map(([k, d]) => (
                <option key={k} value={k}>
                  {d.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Label" htmlFor="ch-label">
            <input id="ch-label" className={textInputClass()} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="e.g. Personal, Office" />
          </FormField>
        </div>
        <FormField label="Value" htmlFor="ch-value" required>
          <input id="ch-value" className={textInputClass()} value={value} onChange={(e) => setValue(e.target.value)} maxLength={300} autoFocus />
        </FormField>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Extra emails and numbers are also used for search and duplicate checks.</p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Add" />
      </form>
    </Modal>
  );
}

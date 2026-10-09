"use client";

import { useState } from "react";
import { crmRequest } from "./crm-api";
import { CrmTagInput, type CrmTagChip } from "./CrmTagInput";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { COUNTRIES } from "@/lib/countries";
import { ADDRESS_TYPES } from "@/modules/crm/contacts/contact-registry";

/** Dialogs shared by every CRM record page (leads keep their Phase 02 dialogs). */

export interface BulkResult {
  requested: number;
  updated: number;
  /** One entry per record not changed; `label` ("OPP-0001 — name") where the endpoint provides it. */
  skipped: { id: string; reason: string; label?: string | null }[];
  /** Bulk audit summary id (opportunities, Phase 08). */
  operationId?: string;
}
export interface UserRefDto {
  id: string;
  fullName: string;
}
export interface TagDto {
  id: string;
  name: string;
  color: string | null;
}
export interface AddressDto {
  id: string;
  addressType: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  isPrimary: boolean;
}

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

export function bulkMessage(r: BulkResult, verb: string, noun = "record") {
  return r.skipped.length ? `${verb} ${r.updated} of ${r.requested}. ${r.skipped.length} skipped.` : `${verb} ${r.updated} ${noun}${r.updated === 1 ? "" : "s"}.`;
}

/** Assign the owner of one record (recordId + version) or many (ids → the entity's bulk endpoint). */
export function AssignOwnerModal({
  apiBase,
  noun,
  onClose,
  users,
  target,
  currentOwnerId,
  onDone,
}: {
  apiBase: string;
  noun: string;
  onClose: () => void;
  users: UserRefDto[];
  target: { recordId: string; version?: number } | { ids: string[] };
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
      ? await crmRequest<BulkResult>(`${apiBase}/bulk`, { method: "POST", body: { action: "assign", ids: target.ids, ownerUserId: ownerId || null }, toast: "errors" })
      : await crmRequest(`${apiBase}/${target.recordId}/assign`, { method: "POST", body: { ownerUserId: ownerId || null, version: target.version }, successMessage: "Owner updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  return (
    <Modal open onClose={onClose} title={bulk ? `Assign ${target.ids.length} ${noun}(s)` : `Assign ${noun}`}>
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

/** Edit tags on one record, or add / remove tags in bulk. */
export function RecordTagsModal({
  apiBase,
  noun,
  onClose,
  target,
  currentTags = [],
  mode = "edit",
  onDone,
}: {
  apiBase: string;
  noun: string;
  onClose: () => void;
  target: { recordId: string } | { ids: string[] };
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
          ? await crmRequest<BulkResult>(`${apiBase}/bulk`, { method: "POST", body: { action: "removeTags", ids: target.ids, tagIds: existing }, toast: "errors" })
          : await crmRequest<BulkResult>(`${apiBase}/bulk`, { method: "POST", body: { action: "addTags", ids: target.ids, tagIds: existing, tagNames: tags.filter((t) => !t.id).map((t) => t.name) }, toast: "errors" });
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
      res = await crmRequest(`${apiBase}/${target.recordId}/tags`, { method: "POST", body, successMessage: "Tags updated." });
    }
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  const title = bulk ? (mode === "remove" ? `Remove tags from ${target.ids.length} ${noun}(s)` : `Add tags to ${target.ids.length} ${noun}(s)`) : "Edit tags";
  return (
    <Modal open onClose={onClose} title={title} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Tags" htmlFor="record-tags-input">
          <CrmTagInput id="record-tags-input" value={tags} onChange={setTags} allowCreate={mode !== "remove"} />
        </FormField>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={mode === "remove" ? "Remove tags" : "Save tags"} disabled={bulk && tags.length === 0} />
      </form>
    </Modal>
  );
}

const emptyAddress = { addressType: "OFFICE", label: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "", isPrimary: false };

/** Add or edit one address of a record (`baseUrl` = the record's API path; shared crm_addresses table). */
export function AddressModal({ baseUrl, address, onClose, onDone }: { baseUrl: string; address: AddressDto | null; onClose: () => void; onDone: () => void }) {
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
      ? await crmRequest(`${baseUrl}/addresses/${address.id}`, { method: "PATCH", body, successMessage: "Address updated." })
      : await crmRequest(`${baseUrl}/addresses`, { method: "POST", body, successMessage: "Address added." });
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


"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { AddressModal, AssignOwnerModal, bulkMessage as recordBulkMessage, RecordTagsModal } from "@/components/crm/CrmRecordDialogs";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import {
  CONTACT_CHANNEL_TYPES,
  CONTACTABILITY_CHANNELS,
  CONTACTABILITY_SOURCES,
  CONTACTABILITY_STATUSES,
  USER_CONTACTABILITY_SOURCES,
  type ContactabilityChannel,
  type ContactabilityStatus,
} from "@/modules/crm/contacts/contact-registry";
import type { BulkResult, ConsentDto } from "./contact-types";

export { AddressModal };

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
  return recordBulkMessage(r, verb, "contact");
}

export function AssignContactModal(props: Omit<Parameters<typeof AssignOwnerModal>[0], "apiBase" | "noun">) {
  return <AssignOwnerModal apiBase="/api/v1/crm/contacts" noun="contact" {...props} />;
}

export function ContactTagsModal(props: Omit<Parameters<typeof RecordTagsModal>[0], "apiBase" | "noun">) {
  return <RecordTagsModal apiBase="/api/v1/crm/contacts" noun="contact" {...props} />;
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

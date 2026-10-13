"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityComposer, RECORD_TYPES } from "@/components/crm/activities/ActivityComposer";
import { useActivityLookups } from "@/components/crm/activities/useActivityLookups";
import { CrmRecordPicker, type CrmPickedRecord } from "@/components/crm/CrmRecordPicker";
import { crmRequest } from "@/components/crm/crm-api";
import { Button, buttonClasses } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import type { DashboardPermissions } from "./dashboard-types";

type Composer = { type: "TASK" | "CALL" | "APPOINTMENT"; mode?: "schedule" | "log" } | null;

const NOTE_PATH: Record<string, string> = { LEAD: "leads", CONTACT: "contacts", COMPANY: "companies", OPPORTUNITY: "opportunities" };

/**
 * Phase 21 — permission-aware shortcuts. Only actions the user can perform
 * are shown (crm.create for records / activities / notes / imports,
 * crm_settings.edit for workflows). Tasks, calls, appointments and notes open
 * in place, reusing the CRM's own composer and record picker.
 */
export function QuickActions({ permissions, currentUserId, onChanged }: { permissions: DashboardPermissions; currentUserId: string; onChanged: () => void }) {
  const [composer, setComposer] = useState<Composer>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const links: { href: string; label: string }[] = [];
  if (permissions.create) {
    links.push({ href: "/crm/leads/new", label: "Add lead" }, { href: "/crm/contacts/new", label: "Add contact" }, { href: "/crm/companies/new", label: "Add company" }, { href: "/crm/opportunities/new", label: "Create opportunity" }, { href: "/crm/leads/import", label: "Import leads" });
  }
  if (permissions.settingsEdit) links.push({ href: "/crm/workflows?new=1", label: "Create workflow" });

  if (!permissions.create && !links.length) return <p className="text-sm text-zinc-500">You can view the CRM but not add records. Ask an administrator if you need to.</p>;
  return (
    <div className="space-y-3">
      {permissions.create && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setComposer({ type: "TASK", mode: "schedule" })}>
            Create task
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setComposer({ type: "CALL", mode: "log" })}>
            Log a call
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setComposer({ type: "APPOINTMENT", mode: "schedule" })}>
            Schedule appointment
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setNoteOpen(true)}>
            Add note
          </Button>
        </div>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={buttonClasses("secondary", "sm")}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
      {composer && <ComposerHost composer={composer} currentUserId={currentUserId} onClose={() => setComposer(null)} onSaved={onChanged} />}
      {noteOpen && <QuickNoteDialog onClose={() => setNoteOpen(false)} onSaved={onChanged} />}
    </div>
  );
}

function ComposerHost({ composer, currentUserId, onClose, onSaved }: { composer: NonNullable<Composer>; currentUserId: string; onClose: () => void; onSaved: () => void }) {
  const { meta, users, error } = useActivityLookups();
  if (error) {
    return (
      <Modal open onClose={onClose} title="New activity">
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      </Modal>
    );
  }
  if (!meta) return null;
  return (
    <ActivityComposer
      meta={meta}
      users={users}
      currentUserId={currentUserId}
      initialType={composer.type}
      initialMode={composer.mode}
      onClose={onClose}
      onSaved={() => {
        onClose();
        onSaved();
      }}
    />
  );
}

/** A note always belongs to a record: pick it, write, save through that record's notes API. */
function QuickNoteDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [recordType, setRecordType] = useState<string>(RECORD_TYPES[0].key);
  const [record, setRecord] = useState<CrmPickedRecord | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rt = RECORD_TYPES.find((r) => r.key === recordType)!;

  const save = async () => {
    if (!record || !body.trim()) return;
    setBusy(true);
    setError(null);
    const r = await crmRequest(`/api/v1/crm/${NOTE_PATH[recordType]}/${record.id}/notes`, { method: "POST", body: { body: body.trim() }, successMessage: "Note added." });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.fieldErrors.body ?? r.error.message);
      return;
    }
    onClose();
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title="Add note" maxWidthClass="max-w-lg">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FormField label="Related to" htmlFor="note-record-type" required>
            <select
              id="note-record-type"
              className={textInputClass()}
              value={recordType}
              onChange={(e) => {
                setRecordType(e.target.value);
                setRecord(null);
              }}
            >
              {RECORD_TYPES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Record" htmlFor="note-record" required>
            <CrmRecordPicker<{ id: string } & Record<string, never>>
              key={recordType}
              id="note-record"
              lookupUrl={rt.url}
              value={record}
              onChange={setRecord}
              toOption={(row) => ({ id: row.id, ...(rt.option as (r: unknown) => { label: string; sublabel: string | null })(row) })}
              placeholder={`Search ${rt.label.toLowerCase()}s…`}
            />
          </FormField>
        </div>
        <FormField label="Note" htmlFor="note-body" required error={error ?? undefined}>
          <textarea id="note-body" rows={4} maxLength={10000} className={textInputClass(Boolean(error))} value={body} onChange={(e) => setBody(e.target.value)} />
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !record || !body.trim()}>
            {busy ? "Saving…" : "Add note"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

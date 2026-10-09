"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmTagInput, type CrmTagChip } from "@/components/crm/CrmTagInput";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { LeadStatusDto, TagDto, UserRefDto } from "./lead-types";

export interface BulkResult {
  requested: number;
  updated: number;
  skipped: { id: string; reason: string }[];
}

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

function bulkMessage(r: BulkResult, verb: string) {
  return r.skipped.length ? `${verb} ${r.updated} of ${r.requested}. ${r.skipped.length} skipped.` : `${verb} ${r.updated} lead${r.updated === 1 ? "" : "s"}.`;
}

/** Assign one lead (leadId + version) or many (ids → bulk endpoint). */
export function AssignLeadModal({
  open,
  onClose,
  users,
  target,
  currentOwnerId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  users: UserRefDto[];
  target: { leadId: string; version?: number } | { ids: string[] };
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
      ? await crmRequest<BulkResult>("/api/v1/crm/leads/bulk", { method: "POST", body: { action: "assign", ids: target.ids, ownerUserId: ownerId || null }, toast: "errors" })
      : await crmRequest(`/api/v1/crm/leads/${target.leadId}/assign`, { method: "POST", body: { ownerUserId: ownerId || null, version: target.version }, successMessage: "Owner updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title={bulk ? `Assign ${target.ids.length} lead(s)` : "Assign lead"}>
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

export function ChangeStatusModal({
  open,
  onClose,
  statuses,
  target,
  currentStatusId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  statuses: LeadStatusDto[];
  target: { leadId: string; version?: number } | { ids: string[] };
  currentStatusId?: string;
  onDone: (result?: BulkResult) => void;
}) {
  const choices = statuses.filter((s) => s.isActive !== false && s.kind !== "CONVERTED");
  const [statusId, setStatusId] = useState(currentStatusId && choices.some((s) => s.id === currentStatusId) ? currentStatusId : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bulk = "ids" in target;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusId) return setError("Choose a status.");
    setBusy(true);
    setError(null);
    const res = bulk
      ? await crmRequest<BulkResult>("/api/v1/crm/leads/bulk", { method: "POST", body: { action: "status", ids: target.ids, statusId }, toast: "errors" })
      : await crmRequest(`/api/v1/crm/leads/${target.leadId}/status`, { method: "POST", body: { statusId, version: target.version }, successMessage: "Status updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  return (
    <Modal open={open} onClose={onClose} title={bulk ? `Change status of ${target.ids.length} lead(s)` : "Change status"}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Status" htmlFor="change-status" required>
          <select id="change-status" className={textInputClass()} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            <option value="">— Select —</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">To mark a lead as converted, use Convert — it creates or links the contact, company and opportunity.</p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Change status" />
      </form>
    </Modal>
  );
}

/** Add/remove tags on one lead, or add / remove tags in bulk. */
export function LeadTagsModal({
  open,
  onClose,
  target,
  currentTags = [],
  mode = "edit",
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  target: { leadId: string } | { ids: string[] };
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
          ? await crmRequest<BulkResult>("/api/v1/crm/leads/bulk", { method: "POST", body: { action: "removeTags", ids: target.ids, tagIds: existing }, toast: "errors" })
          : await crmRequest<BulkResult>("/api/v1/crm/leads/bulk", {
              method: "POST",
              body: { action: "addTags", ids: target.ids, tagIds: existing, tagNames: tags.filter((t) => !t.id).map((t) => t.name) },
              toast: "errors",
            });
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
      res = await crmRequest(`/api/v1/crm/leads/${target.leadId}/tags`, { method: "POST", body, successMessage: "Tags updated." });
    }
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(bulk ? (res.data as BulkResult) : undefined);
  };

  const title = bulk ? (mode === "remove" ? `Remove tags from ${target.ids.length} lead(s)` : `Add tags to ${target.ids.length} lead(s)`) : "Edit tags";
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Tags" htmlFor="lead-tags-input">
          <CrmTagInput id="lead-tags-input" value={tags} onChange={setTags} allowCreate={mode !== "remove"} />
        </FormField>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={mode === "remove" ? "Remove tags" : "Save tags"} disabled={bulk && tags.length === 0} />
      </form>
    </Modal>
  );
}

export function CreateOpportunityModal({
  open,
  onClose,
  lead,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  lead: { id: string; fullName: string; companyName: string | null; estimatedValue: string | null; currencyCode: string | null };
  onDone: (opportunity: { id: string; opportunityNumber: string; name: string }) => void;
}) {
  const [name, setName] = useState([lead.companyName, lead.fullName].filter(Boolean).join(" — "));
  const [amount, setAmount] = useState(lead.estimatedValue ?? "");
  const [closeDate, setCloseDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await crmRequest<{ id: string; opportunityNumber: string; name: string }>(`/api/v1/crm/leads/${lead.id}/opportunities`, {
      method: "POST",
      body: { name, amount: amount === "" ? null : Number(amount), currencyCode: lead.currencyCode, expectedCloseDate: closeDate || null },
      successMessage: "Opportunity created.",
    });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone(res.data);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create opportunity" maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Opportunity name" htmlFor="opp-name" required>
          <input id="opp-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label={`Amount${lead.currencyCode ? ` (${lead.currencyCode})` : ""}`} htmlFor="opp-amount">
            <input id="opp-amount" type="number" min={0} step="0.01" className={textInputClass()} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </FormField>
          <FormField label="Expected close" htmlFor="opp-close">
            <input id="opp-close" type="date" className={textInputClass()} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </FormField>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">The opportunity is linked to this lead and its contact/company (if any). Pipelines and stages are added in a later phase.</p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Create opportunity" />
      </form>
    </Modal>
  );
}

export { bulkMessage };

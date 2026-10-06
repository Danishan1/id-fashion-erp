"use client";

import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import type { BulkResult } from "@/components/crm/CrmRecordDialogs";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { humanizeStatus } from "@/lib/humanize-status";
import { ERP_DOC_TYPE_KEYS, ERP_DOC_TYPES, OPPORTUNITY_STATUS_TRANSITIONS, OPPORTUNITY_STATUSES, type ErpDocType, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { opportunityValue } from "./OpportunityBadges";
import type { PipelineDto } from "./opportunity-types";

const API = "/api/v1/crm/opportunities";
type Target = { recordId: string; version?: number } | { ids: string[] };

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

/**
 * Move one open opportunity (or many, within their pipeline) to a stage.
 * The stage's default probability is suggested; the server records the old
 * and new stage and probability on the timeline.
 */
export function ChangeStageModal({
  pipelines,
  target,
  current,
  onClose,
  onDone,
}: {
  pipelines: PipelineDto[];
  target: Target;
  current?: { pipelineId: string | null; stageId: string | null; probability: number | null };
  onClose: () => void;
  onDone: (result?: BulkResult) => void;
}) {
  const bulk = "ids" in target;
  const usable = pipelines.filter((p) => p.isActive || p.id === current?.pipelineId);
  const [pipelineId, setPipelineId] = useState(current?.pipelineId ?? usable.find((p) => p.isDefault)?.id ?? usable[0]?.id ?? "");
  const pipeline = usable.find((p) => p.id === pipelineId);
  const stages = (pipeline?.stages ?? []).filter((s) => s.isActive || s.id === current?.stageId);
  const [stageId, setStageId] = useState(current?.stageId ?? stages[0]?.id ?? "");
  const oldStage = pipelines.flatMap((p) => p.stages).find((s) => s.id === current?.stageId);
  const newStage = stages.find((s) => s.id === stageId);
  const keepsManual = current && current.probability !== null && current.probability !== (oldStage?.probability ?? null);
  const suggested = keepsManual ? current!.probability : (newStage?.probability ?? current?.probability ?? null);
  const [probability, setProbability] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageId) return setError("Choose a stage.");
    setBusy(true);
    setError(null);
    if (bulk) {
      const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "stage", ids: target.ids, stageId }, toast: "errors" });
      setBusy(false);
      if (!res.ok) return setError(res.error.message);
      return onDone(res.data);
    }
    const body: Record<string, unknown> = { stageId, pipelineId, version: target.version };
    if (probability.trim() !== "") body.probability = probability.trim();
    const res = await crmRequest(`${API}/${target.recordId}/stage`, { method: "POST", body, successMessage: "Stage updated." });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.probability ?? res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={bulk ? `Change stage of ${target.ids.length} opportunity(ies)` : "Change stage"} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        {usable.length > 1 && (
          <FormField label="Pipeline" htmlFor="opp-stage-pipeline">
            <select
              id="opp-stage-pipeline"
              className={textInputClass()}
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId(usable.find((p) => p.id === e.target.value)?.stages.find((s) => s.isActive)?.id ?? "");
              }}
            >
              {usable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
        )}
        <FormField label="Stage" htmlFor="opp-stage" required>
          <select id="opp-stage" className={textInputClass()} value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.probability !== null ? ` (${s.probability}%)` : ""}
              </option>
            ))}
          </select>
        </FormField>
        {!bulk && (
          <FormField label="Probability %" htmlFor="opp-stage-probability">
            <input id="opp-stage-probability" type="number" min={0} max={100} step={1} className={textInputClass()} value={probability} onChange={(e) => setProbability(e.target.value)} placeholder={suggested !== null ? String(suggested) : "0–100"} />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {keepsManual ? "Your own probability is kept unless you enter a new one." : "Leave blank to use the stage's default probability."}
            </p>
          </FormField>
        )}
        {bulk && <p className="text-xs text-zinc-500 dark:text-zinc-400">Closed opportunities and ones in another pipeline are skipped. Each one keeps a probability its owner set by hand.</p>}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Save" disabled={!stageId || (!bulk && stageId === current?.stageId && probability.trim() === "")} />
      </form>
    </Modal>
  );
}

/**
 * Status change: Open → Won / Lost / Abandoned (with an optional reason), or
 * Reopen a closed opportunity. The server stores closed_at and records the
 * change on the timeline and in the audit log.
 */
export function ChangeOpportunityStatusModal({
  target,
  current,
  initialStatus,
  reasons,
  onClose,
  onDone,
}: {
  target: Target;
  current?: OpportunityStatus;
  initialStatus?: OpportunityStatus;
  reasons: string[];
  onClose: () => void;
  onDone: (result?: BulkResult) => void;
}) {
  const bulk = "ids" in target;
  const options = (bulk ? (Object.keys(OPPORTUNITY_STATUSES) as OpportunityStatus[]) : OPPORTUNITY_STATUS_TRANSITIONS[current ?? "OPEN"]) as OpportunityStatus[];
  const [status, setStatus] = useState<OpportunityStatus>(initialStatus && options.includes(initialStatus) ? initialStatus : options[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closing = OPPORTUNITY_STATUSES[status].closed;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { status, reason: closing ? reason || null : null };
    if (bulk) {
      const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "status", ids: target.ids, ...body }, toast: "errors" });
      setBusy(false);
      if (!res.ok) return setError(res.error.message);
      return onDone(res.data);
    }
    const res = await crmRequest(`${API}/${target.recordId}/status`, { method: "POST", body: { ...body, version: target.version }, successMessage: status === "OPEN" ? "Opportunity reopened." : `Marked ${OPPORTUNITY_STATUSES[status].label.toLowerCase()}.` });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  const title = bulk ? `Change status of ${target.ids.length} opportunity(ies)` : current && current !== "OPEN" ? "Reopen opportunity" : "Close opportunity";
  return (
    <Modal open onClose={onClose} title={title} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Status" htmlFor="opp-status" required>
          <select id="opp-status" className={textInputClass()} value={status} onChange={(e) => setStatus(e.target.value as OpportunityStatus)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {s === "OPEN" && current && current !== "OPEN" ? "Reopen (Open)" : OPPORTUNITY_STATUSES[s].label}
              </option>
            ))}
          </select>
        </FormField>
        {closing && (
          <FormField label={status === "WON" ? "Why it was won (optional)" : "Reason (optional)"} htmlFor="opp-status-reason">
            <input id="opp-status-reason" className={textInputClass()} value={reason} maxLength={500} list="opp-close-reasons" onChange={(e) => setReason(e.target.value)} />
            <datalist id="opp-close-reasons">
              {reasons.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </FormField>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {closing
            ? "The close date is recorded. A closed opportunity can't be edited until it is reopened; nothing is deleted."
            : "Reopening clears the close date and reason (they stay in the timeline)."}
          {bulk ? " Opportunities that can't move to this status directly are skipped." : ""}
        </p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={status === "OPEN" ? "Reopen" : "Save"} disabled={!bulk && status === current} />
      </form>
    </Modal>
  );
}

interface ErpDocRow {
  id: string;
  number: string;
  date: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  subtitle: string | null;
  customerName: string | null;
  alreadyLinked: boolean;
}

/** Link an existing ERP document (buyer enquiry, sample request, sales order). Nothing is created or changed in the ERP. */
export function LinkErpDocumentModal({ opportunityId, onClose, onDone }: { opportunityId: string; onClose: () => void; onDone: () => void }) {
  const [docType, setDocType] = useState<ErpDocType>(ERP_DOC_TYPE_KEYS[0]);
  const [term, setTerm] = useState("");
  const [result, setResult] = useState<{ customerLinked: boolean; rows: ErpDocRow[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ErpDocRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => `${API}/${opportunityId}/erp-documents/search?docType=${docType}&limit=20${term.trim() ? `&search=${encodeURIComponent(term.trim())}` : ""}`, [opportunityId, docType, term]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      crmRequest<{ customerLinked: boolean; rows: ErpDocRow[] }>(query).then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setResult(res.data);
          setSearchError(null);
        } else setSearchError(res.error.message);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return setError("Pick a document.");
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${API}/${opportunityId}/erp-documents`, { method: "POST", body: { docType, docId: picked.id }, toast: "errors", successMessage: "ERP document linked." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Link ERP document" maxWidthClass="max-w-xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="Document type" htmlFor="erp-doc-type">
            <select
              id="erp-doc-type"
              className={textInputClass()}
              value={docType}
              onChange={(e) => {
                setDocType(e.target.value as ErpDocType);
                setPicked(null);
              }}
            >
              {ERP_DOC_TYPE_KEYS.map((t) => (
                <option key={t} value={t}>
                  {ERP_DOC_TYPES[t].label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Search" htmlFor="erp-doc-search">
            <input id="erp-doc-search" className={textInputClass()} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Document number" autoFocus />
          </FormField>
        </div>
        {searchError ? (
          <ErrorLine message={searchError} />
        ) : !result ? (
          <p className="text-sm text-zinc-500">Searching…</p>
        ) : result.rows.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{result.customerLinked ? "No documents found for this customer." : "This opportunity's company isn't linked to an ERP customer — type at least 2 characters of a document number."}</p>
        ) : (
          <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
            {result.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={r.alreadyLinked}
                  aria-pressed={picked?.id === r.id}
                  onClick={() => setPicked(r)}
                  className={`block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${picked?.id === r.id ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"}`}
                >
                  <span className="font-medium">{r.number}</span>{" "}
                  <span className="text-xs text-zinc-500">{[r.date.slice(0, 10), humanizeStatus(r.status), opportunityValue(r.amount, r.currencyCode), r.customerName, r.subtitle].filter(Boolean).join(" · ")}</span>
                  {r.alreadyLinked && <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">Already linked</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">The ERP stays the system of record: amounts and statuses are read live and never copied into the opportunity. The ERP has no quotation module yet.</p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Link document" disabled={!picked} />
      </form>
    </Modal>
  );
}

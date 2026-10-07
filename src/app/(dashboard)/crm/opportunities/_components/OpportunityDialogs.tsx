"use client";

import { useEffect, useMemo, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmCustomFieldInputs } from "@/components/crm/CrmCustomFields";
import type { BulkResult } from "@/components/crm/CrmRecordDialogs";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { humanizeStatus } from "@/lib/humanize-status";
import { ERP_DOC_TYPE_KEYS, ERP_DOC_TYPES, OPPORTUNITY_STATUS_TRANSITIONS, OPPORTUNITY_STATUSES, type ErpDocType, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";
import { opportunityValue } from "./OpportunityBadges";
import type { OpportunityMetaDto, PipelineDto, TransitionCheckDto } from "./opportunity-types";

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

/** Reasons a move is refused (rules, missing required fields), as returned by the server. */
function BlockedMoveNotice({ check }: { check: Pick<TransitionCheckDto, "reasons" | "missingFields"> }) {
  const reasons = check.reasons.filter((r) => r.code !== "REQUIRED_FIELDS_MISSING");
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      {reasons.map((r) => (
        <p key={r.code + r.message}>{r.message}</p>
      ))}
      {check.missingFields.length > 0 && (
        <>
          <p className="font-medium">Fill these in first:</p>
          <ul className="ml-4 list-disc">
            {check.missingFields.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const blockedFromError = (error: { code: string | null; details: Record<string, unknown> | null }) =>
  error.code === "CRM_STAGE_TRANSITION_BLOCKED" && error.details
    ? { reasons: (error.details.reasons as TransitionCheckDto["reasons"]) ?? [], missingFields: (error.details.missingFields as TransitionCheckDto["missingFields"]) ?? [] }
    : null;

/** Server dry run of a single-record move (rules + required fields); null while loading or not applicable. */
function useTransitionCheck(recordId: string | null, stageId: string, currentStageId: string | null | undefined) {
  const [result, setResult] = useState<{ key: string; check: TransitionCheckDto | null } | null>(null);
  const key = `${recordId}:${stageId}`;
  useEffect(() => {
    if (!recordId || !stageId || stageId === currentStageId) return;
    let cancelled = false;
    crmRequest<TransitionCheckDto>(`${API}/${recordId}/stage/validate`, { method: "POST", body: { stageId }, toast: "off" }).then((res) => {
      if (!cancelled) setResult({ key: `${recordId}:${stageId}`, check: res.ok ? res.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [recordId, stageId, currentStageId]);
  return result?.key === key ? result.check : null;
}

/**
 * Move one open opportunity (or many, within their pipeline) to a stage.
 * The server validates every move (transition rules, the stage's required
 * fields); for a single record the result is checked as soon as a stage is
 * picked, and a refused move lists what is missing. A probability set by
 * hand is kept unless "use the stage's probability" is ticked.
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
  current?: { pipelineId: string | null; stageId: string | null; probability: number | null; probabilitySource?: string | null };
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
  const keepsManual = Boolean(
    current && current.probability !== null && (current.probabilitySource ? current.probabilitySource === "MANUAL" : current.probability !== (oldStage?.probability ?? null))
  );
  const [useStageProbability, setUseStageProbability] = useState(false);
  const suggested = keepsManual && !useStageProbability ? current!.probability : (newStage?.probability ?? current?.probability ?? null);
  const [probability, setProbability] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ stageId: string; reasons: TransitionCheckDto["reasons"]; missingFields: TransitionCheckDto["missingFields"] } | null>(null);
  const check = useTransitionCheck(bulk ? null : target.recordId, stageId, current?.stageId);
  const refusal = blocked?.stageId === stageId ? blocked : check?.allowed === false ? check : null;

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
    else if (useStageProbability) body.useStageProbability = true;
    const res = await crmRequest(`${API}/${target.recordId}/stage`, { method: "POST", body, successMessage: "Stage updated.", toast: "errors" });
    setBusy(false);
    if (!res.ok) {
      const b = blockedFromError(res.error);
      if (b) return setBlocked({ stageId, ...b });
      return setError(res.error.fieldErrors.probability ?? res.error.message);
    }
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
                const p = usable.find((x) => x.id === e.target.value);
                setStageId(p?.stages.find((s) => s.isActive && s.isDefault)?.id ?? p?.stages.find((s) => s.isActive)?.id ?? "");
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
            {keepsManual ? (
              <label className="mt-1 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <input type="checkbox" checked={useStageProbability} onChange={(e) => setUseStageProbability(e.target.checked)} />
                Your own probability ({current!.probability}%) is kept. Tick to use the stage&apos;s default instead.
              </label>
            ) : (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Leave blank to use the stage&apos;s default probability.</p>
            )}
          </FormField>
        )}
        {bulk && <p className="text-xs text-zinc-500 dark:text-zinc-400">Each opportunity is checked on its own: closed ones, ones in another pipeline and ones missing the stage&apos;s required fields are skipped and listed. A probability set by hand is kept.</p>}
        {refusal && <BlockedMoveNotice check={refusal} />}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Save" disabled={!stageId || Boolean(refusal) || (!bulk && stageId === current?.stageId && probability.trim() === "" && !useStageProbability)} />
      </form>
    </Modal>
  );
}

/** Move an opportunity to another pipeline (its default stage unless another is chosen). */
export function TransferPipelineModal({ pipelines, target, currentPipelineId, onClose, onDone }: { pipelines: PipelineDto[]; target: { recordId: string; version?: number }; currentPipelineId: string | null; onClose: () => void; onDone: () => void }) {
  const others = pipelines.filter((p) => p.isActive && p.id !== currentPipelineId);
  const [pipelineId, setPipelineId] = useState(others.find((p) => p.isDefault)?.id ?? others[0]?.id ?? "");
  const pipeline = others.find((p) => p.id === pipelineId);
  const activeStages = (pipeline?.stages ?? []).filter((s) => s.isActive);
  const [stageId, setStageId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ key: string; reasons: TransitionCheckDto["reasons"]; missingFields: TransitionCheckDto["missingFields"] } | null>(null);
  const key = `${pipelineId}:${stageId}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await crmRequest(`${API}/${target.recordId}/transfer`, { method: "POST", body: { pipelineId, ...(stageId ? { stageId } : {}), reason, version: target.version }, successMessage: "Moved to another pipeline.", toast: "errors" });
    setBusy(false);
    if (!res.ok) {
      const b = blockedFromError(res.error);
      if (b) return setBlocked({ key, ...b });
      return setError(res.error.message);
    }
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Move to another pipeline" maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        {others.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">There is no other active pipeline. Add one in CRM Settings → Pipelines &amp; stages.</p>
        ) : (
          <>
            <FormField label="Pipeline" htmlFor="opp-transfer-pipeline" required>
              <select
                id="opp-transfer-pipeline"
                className={textInputClass()}
                value={pipelineId}
                onChange={(e) => {
                  setPipelineId(e.target.value);
                  setStageId("");
                }}
              >
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Stage" htmlFor="opp-transfer-stage">
              <select id="opp-transfer-stage" className={textInputClass()} value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">Default stage{activeStages.find((s) => s.isDefault) ? ` (${activeStages.find((s) => s.isDefault)!.name})` : ""}</option>
                {activeStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Reason" htmlFor="opp-transfer-reason">
              <input id="opp-transfer-reason" className={textInputClass()} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — shown on the timeline" />
            </FormField>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">The destination stage&apos;s required fields apply. A probability set by hand is kept; otherwise the new stage&apos;s default is used.</p>
          </>
        )}
        {blocked?.key === key && <BlockedMoveNotice check={blocked} />}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Move" disabled={!pipelineId || blocked?.key === key} />
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

/**
 * Bulk "Update fields" (Phase 08): only fields that are safe to set on many
 * records at once — source, expected close date and custom fields. Each
 * record is updated through the normal single-record update (validation,
 * version, audit); records that can't be changed are reported one by one.
 */
export function BulkUpdateFieldsModal({ ids, meta, onClose, onDone }: { ids: string[]; meta: OpportunityMetaDto; onClose: () => void; onDone: (result: BulkResult) => void }) {
  const [use, setUse] = useState({ source: false, close: false, custom: false });
  const [sourceId, setSourceId] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const customDefs = meta.customFields.filter((d) => d.isActive);
  const [customKey, setCustomKey] = useState(customDefs[0]?.key ?? "");
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const customDef = customDefs.find((d) => d.key === customKey);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fields: Record<string, unknown> = {};
    if (use.source) fields.sourceId = sourceId || null;
    if (use.close) fields.expectedCloseDate = closeDate || null;
    if (use.custom && customDef) fields.customFields = { [customDef.key]: customValues[customDef.key] ?? null };
    if (!Object.keys(fields).length) return setError("Choose at least one field to update.");
    setBusy(true);
    setError(null);
    const res = await crmRequest<BulkResult>(`${API}/bulk`, { method: "POST", body: { action: "update", ids, fields }, toast: "errors" });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onDone(res.data);
  };

  const check = (key: keyof typeof use, label: string) => (
    <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
      <input type="checkbox" checked={use[key]} onChange={(e) => setUse((u) => ({ ...u, [key]: e.target.checked }))} />
      {label}
    </label>
  );
  return (
    <Modal open onClose={onClose} title={`Update ${ids.length} opportunit${ids.length === 1 ? "y" : "ies"}`} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Only ticked fields change. Each opportunity is saved separately, so one that can&apos;t be changed doesn&apos;t stop the others.</p>
        <div className="space-y-2">
          {check("source", "Source")}
          {use.source && (
            <select aria-label="New source" className={textInputClass()} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— No source —</option>
              {meta.sources
                .filter((s) => s.isActive !== false)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          )}
        </div>
        <div className="space-y-2">
          {check("close", "Expected close date")}
          {use.close && <input type="date" aria-label="New expected close date" className={textInputClass(Boolean(fieldErrors.expectedCloseDate))} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />}
          {use.close && !closeDate && <p className="text-xs text-zinc-500">Leave empty to clear the date.</p>}
        </div>
        {customDefs.length > 0 && (
          <div className="space-y-2">
            {check("custom", "Custom field")}
            {use.custom && (
              <>
                <select aria-label="Custom field to update" className={textInputClass()} value={customKey} onChange={(e) => setCustomKey(e.target.value)}>
                  {customDefs.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {customDef && <CrmCustomFieldInputs definitions={[{ ...customDef, isRequired: false }]} values={customValues} onChange={(k, v) => setCustomValues((c) => ({ ...c, [k]: v }))} errors={fieldErrors} />}
              </>
            )}
          </div>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Update" disabled={!use.source && !use.close && !use.custom} />
      </form>
    </Modal>
  );
}

/** Per-record outcome of a bulk action: how many changed and why each skipped record wasn't. */
export function BulkResultModal({ title, result, onClose }: { title: string; result: BulkResult; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={title} maxWidthClass="max-w-lg">
      <div className="mt-3 space-y-3 text-sm">
        <p>
          <span className="font-medium text-green-700 dark:text-green-400">{result.updated} updated</span>
          {" · "}
          <span className={result.skipped.length ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>{result.skipped.length} not changed</span>
          {" · "}
          {result.requested} selected
        </p>
        {result.skipped.length > 0 && (
          <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Opportunity</th>
                  <th className="px-3 py-1.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-1.5">{s.label ? <a href={`/crm/opportunities/${s.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">{s.label}</a> : <span className="text-zinc-400">Not available</span>}</td>
                    <td className="px-3 py-1.5">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

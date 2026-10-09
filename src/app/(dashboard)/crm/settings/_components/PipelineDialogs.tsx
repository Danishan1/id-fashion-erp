"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { PIPELINES_API, type PipelineDetailDto, type RequirementOptionDto, type SettingsPipelineDto, type SettingsStageDto } from "./pipeline-settings-types";

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {message}
    </p>
  ) : null;
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Pipelines ────────────────────────────────────────────────────

export function PipelineModal({ pipeline, onClose, onSaved }: { pipeline: SettingsPipelineDto | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const [name, setName] = useState(pipeline?.name ?? "");
  const [description, setDescription] = useState(pipeline?.description ?? "");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = pipeline
      ? await crmRequest<{ id: string }>(`${PIPELINES_API}/${pipeline.id}`, { method: "PATCH", body: { version: pipeline.version, name, description }, successMessage: "Pipeline updated." })
      : await crmRequest<{ id: string }>(PIPELINES_API, { method: "POST", body: { name, description, isDefault }, successMessage: "Pipeline added." });
    setBusy(false);
    if (!res.ok) return setError(res.error.fieldErrors.name ?? res.error.message);
    onSaved(res.data?.id);
  };

  return (
    <Modal open onClose={onClose} title={pipeline ? `Edit "${pipeline.name}"` : "Add pipeline"} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="pipeline-name" required>
          <input id="pipeline-name" className={textInputClass()} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </FormField>
        <FormField label="Description" htmlFor="pipeline-description">
          <textarea id="pipeline-description" rows={2} maxLength={500} className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {!pipeline && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Make this the default pipeline for new opportunities
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">It starts with the standard stages (New → Closing). Rename, reorder or add stages afterwards.</p>
          </>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={pipeline ? "Save" : "Add pipeline"} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

/**
 * Archive a pipeline. While opportunities use it, a destination pipeline
 * (and optionally stage) must be chosen and the move confirmed.
 */
export function ArchivePipelineModal({ pipeline, pipelines, onClose, onDone }: { pipeline: SettingsPipelineDto; pipelines: SettingsPipelineDto[]; onClose: () => void; onDone: () => void }) {
  const targets = pipelines.filter((p) => p.id !== pipeline.id && p.status === "ACTIVE");
  const [targetPipelineId, setTargetPipelineId] = useState(targets.find((p) => p.isDefault)?.id ?? targets[0]?.id ?? "");
  const target = targets.find((p) => p.id === targetPipelineId);
  const targetStages = (target?.stages ?? []).filter((s) => s.status === "ACTIVE");
  const [targetStageId, setTargetStageId] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = pipeline.opportunityCount > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { version: pipeline.version };
    if (used) Object.assign(body, { targetPipelineId, confirm, ...(targetStageId ? { targetStageId } : {}) });
    const res = await crmRequest(`${PIPELINES_API}/${pipeline.id}/archive`, { method: "POST", body, successMessage: "Pipeline archived." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={`Archive "${pipeline.name}"`} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        {pipeline.isDefault ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">This is the default pipeline. Make another pipeline the default first.</p>
        ) : !used ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">No opportunities use this pipeline. It will be hidden from pickers; you can restore it later.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {plural(pipeline.opportunityCount, "opportunity", "opportunities")} ({pipeline.openOpportunityCount} open) use this pipeline. Choose where they move — each move is recorded on the opportunity&apos;s timeline.
            </p>
            {targets.length === 0 ? (
              <p className="text-sm text-red-600 dark:text-red-400">Add another active pipeline first.</p>
            ) : (
              <>
                <FormField label="Move to pipeline" htmlFor="archive-pipeline-target" required>
                  <select
                    id="archive-pipeline-target"
                    className={textInputClass()}
                    value={targetPipelineId}
                    onChange={(e) => {
                      setTargetPipelineId(e.target.value);
                      setTargetStageId("");
                    }}
                  >
                    {targets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Into stage" htmlFor="archive-pipeline-stage">
                  <select id="archive-pipeline-stage" className={textInputClass()} value={targetStageId} onChange={(e) => setTargetStageId(e.target.value)}>
                    <option value="">Its default stage</option>
                    {targetStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                  Move {plural(pipeline.opportunityCount, "opportunity", "opportunities")} to {target?.name ?? "the selected pipeline"} and archive this pipeline.
                </label>
              </>
            )}
          </>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Archive" danger disabled={pipeline.isDefault || (used && (!targetPipelineId || !confirm))} />
      </form>
    </Modal>
  );
}

// ── Stages ───────────────────────────────────────────────────────

/** Checkbox list of every requirement, grouped (built-in fields, ERP documents, custom fields). */
export function RequirementPicker({ idPrefix, options, unavailable, value, onChange }: { idPrefix: string; options: RequirementOptionDto[]; unavailable?: readonly { key: string; label: string; reason: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const groups = [...new Set(options.map((o) => o.group))];
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <fieldset key={g}>
          <legend className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{g}</legend>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
            {options
              .filter((o) => o.group === g && (!o.inactive || value.includes(o.key)))
              .map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-sm" htmlFor={`${idPrefix}-${o.key}`}>
                  <input id={`${idPrefix}-${o.key}`} type="checkbox" checked={value.includes(o.key)} onChange={() => toggle(o.key)} />
                  {o.label}
                  {o.inactive && <span className="text-xs text-zinc-400">(inactive)</span>}
                </label>
              ))}
          </div>
        </fieldset>
      ))}
      {unavailable?.map((u) => (
        <p key={u.key} className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-medium">{u.label}:</span> not available — {u.reason}
        </p>
      ))}
    </div>
  );
}

export function StageModal({ pipeline, stage, onClose, onSaved }: { pipeline: PipelineDetailDto; stage: SettingsStageDto | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(stage?.name ?? "");
  const [description, setDescription] = useState(stage?.description ?? "");
  const [probability, setProbability] = useState(stage?.probability === null || stage?.probability === undefined ? "" : String(stage.probability));
  const [requiredFields, setRequiredFields] = useState<string[]>(stage?.requiredFields ?? []);
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { name, description, probability, requiredFields };
    const res = stage
      ? await crmRequest(`${PIPELINES_API}/${pipeline.id}/stages/${stage.id}`, { method: "PATCH", body: { ...body, version: stage.version }, successMessage: "Stage updated." })
      : await crmRequest(`${PIPELINES_API}/${pipeline.id}/stages`, { method: "POST", body: { ...body, isDefault }, successMessage: "Stage added." });
    setBusy(false);
    if (!res.ok) {
      setFieldErrors(res.error.fieldErrors);
      return setError(res.error.message);
    }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={stage ? `Edit stage "${stage.name}"` : `Add stage to ${pipeline.name}`} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Name" htmlFor="stage-name" required error={fieldErrors.name}>
          <input id="stage-name" className={textInputClass(Boolean(fieldErrors.name))} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </FormField>
        <FormField label="Description" htmlFor="stage-description">
          <textarea id="stage-description" rows={2} maxLength={500} className={textInputClass()} value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        <FormField label="Default probability %" htmlFor="stage-probability" error={fieldErrors.probability}>
          <input id="stage-probability" type="number" min={0} max={100} step={1} className={textInputClass(Boolean(fieldErrors.probability))} value={probability} onChange={(e) => setProbability(e.target.value)} placeholder="0–100" />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Applied when an opportunity enters this stage, unless its owner set a probability by hand. Changing it doesn&apos;t change existing opportunities.</p>
        </FormField>
        <div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Required before entering this stage</p>
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">A move into this stage is refused until these are filled in.</p>
          <RequirementPicker idPrefix="stage-req" options={pipeline.requirementOptions} unavailable={pipeline.unavailableRequirements} value={requiredFields} onChange={setRequiredFields} />
        </div>
        {!stage && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            New opportunities in this pipeline start here (default stage)
          </label>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label={stage ? "Save" : "Add stage"} disabled={!name.trim()} />
      </form>
    </Modal>
  );
}

type RuleChoice = "none" | "allow" | "block";

/** Where an opportunity may go from this stage, and what a specific move requires. */
export function TransitionRulesModal({ pipeline, stage, onClose, onSaved }: { pipeline: PipelineDetailDto; stage: SettingsStageDto; onClose: () => void; onSaved: () => void }) {
  const others = pipeline.stages.filter((s) => s.id !== stage.id && s.status === "ACTIVE");
  const existing = new Map((stage.transitionRules ?? []).map((r) => [r.toStageId, r]));
  const [mode, setMode] = useState(stage.transitionMode);
  const [rules, setRules] = useState<Record<string, { choice: RuleChoice; requiredFields: string[]; message: string }>>(() =>
    Object.fromEntries(others.map((s) => {
      const r = existing.get(s.id);
      return [s.id, { choice: r ? (r.allowed ? "allow" : "block") : "none", requiredFields: r?.requiredFields ?? [], message: r?.message ?? "" }];
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, patch: Partial<(typeof rules)[string]>) => setRules((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Rules to archived stages are kept as they are.
    const kept = (stage.transitionRules ?? []).filter((r) => !others.some((s) => s.id === r.toStageId)).map((r) => ({ toStageId: r.toStageId, allowed: r.allowed, requiredFields: r.requiredFields, message: r.message }));
    const body = {
      version: stage.version,
      transitionMode: mode,
      rules: [
        ...kept,
        ...Object.entries(rules)
          .filter(([, r]) => r.choice !== "none")
          .map(([toStageId, r]) => ({ toStageId, allowed: r.choice === "allow", requiredFields: r.choice === "allow" ? r.requiredFields : [], message: r.choice === "block" ? r.message : null })),
      ],
    };
    const res = await crmRequest(`${PIPELINES_API}/${pipeline.id}/stages/${stage.id}/transition-rules`, { method: "PUT", body, successMessage: "Transition rules saved." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={`Moves from "${stage.name}"`} maxWidthClass="max-w-2xl">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset className="space-y-1 text-sm">
          <legend className="font-medium text-zinc-800 dark:text-zinc-200">From this stage an opportunity can move to</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="transition-mode" checked={mode === "ANY"} onChange={() => setMode("ANY")} />
            Any stage, unless blocked below
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="transition-mode" checked={mode === "ONLY_LISTED"} onChange={() => setMode("ONLY_LISTED")} />
            Only the stages marked &quot;Allowed&quot; below
          </label>
        </fieldset>
        <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {others.length === 0 && <p className="p-3 text-sm text-zinc-500">This pipeline has no other active stages.</p>}
          {others.map((s) => {
            const r = rules[s.id];
            return (
              <div key={s.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">→ {s.name}</span>
                  <select aria-label={`Rule for moving to ${s.name}`} className={`${textInputClass()} w-auto`} value={r.choice} onChange={(e) => set(s.id, { choice: e.target.value as RuleChoice })}>
                    <option value="none">{mode === "ANY" ? "Allowed (no rule)" : "Not allowed (no rule)"}</option>
                    <option value="allow">Allowed</option>
                    <option value="block">Blocked</option>
                  </select>
                </div>
                {r.choice === "block" && (
                  <input aria-label={`Message when moving to ${s.name} is blocked`} className={textInputClass()} maxLength={200} placeholder="Message shown to the user (optional)" value={r.message} onChange={(e) => set(s.id, { message: e.target.value })} />
                )}
                {r.choice === "allow" && (
                  <details>
                    <summary className="cursor-pointer text-xs text-indigo-600 dark:text-indigo-400">Also required for this move{r.requiredFields.length ? ` (${r.requiredFields.length})` : ""}</summary>
                    <div className="mt-2">
                      <RequirementPicker idPrefix={`rule-${s.id}`} options={pipeline.requirementOptions} value={r.requiredFields} onChange={(v) => set(s.id, { requiredFields: v })} />
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">The destination stage&apos;s own required fields always apply as well. Rules don&apos;t apply when an opportunity moves to another pipeline.</p>
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Save rules" />
      </form>
    </Modal>
  );
}

/** Archive a stage; opportunities in it are moved (after confirmation) to another active stage of the pipeline. */
export function ArchiveStageModal({ pipeline, stage, onClose, onDone }: { pipeline: PipelineDetailDto; stage: SettingsStageDto; onClose: () => void; onDone: () => void }) {
  const targets = pipeline.stages.filter((s) => s.id !== stage.id && s.status === "ACTIVE");
  const [reassignToStageId, setReassign] = useState(targets.find((s) => s.isDefault)?.id ?? targets[0]?.id ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = stage.opportunityCount ?? 0;
  const blocked = stage.isDefault || targets.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { version: stage.version, ...(count ? { reassignToStageId, confirm } : {}) };
    const res = await crmRequest(`${PIPELINES_API}/${pipeline.id}/stages/${stage.id}/archive`, { method: "POST", body, successMessage: "Stage archived." });
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    onDone();
  };

  return (
    <Modal open onClose={onClose} title={`Archive stage "${stage.name}"`} maxWidthClass="max-w-md">
      <form onSubmit={submit} className="mt-4 space-y-4">
        {stage.isDefault ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">This is the pipeline&apos;s default stage. Make another stage the default first.</p>
        ) : targets.length === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">A pipeline needs at least one active stage.</p>
        ) : count === 0 ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">No opportunities are in this stage. It will no longer be offered; you can restore it later.</p>
        ) : (
          <>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              {plural(count, "opportunity is", "opportunities are")} in this stage ({stage.openOpportunityCount ?? 0} open; closed and archived ones move too). Each move is recorded on its timeline. Open
              opportunities follow the new stage&apos;s probability unless set by hand.
            </p>
            <FormField label="Move them to" htmlFor="archive-stage-target" required>
              <select id="archive-stage-target" className={textInputClass()} value={reassignToStageId} onChange={(e) => setReassign(e.target.value)}>
                {targets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              Move {plural(count, "opportunity", "opportunities")} to {targets.find((s) => s.id === reassignToStageId)?.name} and archive &quot;{stage.name}&quot;.
            </label>
          </>
        )}
        <ErrorLine message={error} />
        <Footer onCancel={onClose} busy={busy} label="Archive" danger disabled={blocked || (count > 0 && (!reassignToStageId || !confirm))} />
      </form>
    </Modal>
  );
}

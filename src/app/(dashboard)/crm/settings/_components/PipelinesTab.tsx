"use client";

import { useEffect, useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { ArchivePipelineModal, ArchiveStageModal, PipelineModal, StageModal, TransitionRulesModal } from "./PipelineDialogs";
import { PIPELINES_API, type PipelineDetailDto, type SettingsPipelineDto, type SettingsStageDto } from "./pipeline-settings-types";
import { useSettingsList } from "./useSettingsList";

type Dialog =
  | { kind: "pipeline"; pipeline: SettingsPipelineDto | null }
  | { kind: "archive-pipeline"; pipeline: SettingsPipelineDto }
  | { kind: "stage"; stage: SettingsStageDto | null }
  | { kind: "rules"; stage: SettingsStageDto }
  | { kind: "archive-stage"; stage: SettingsStageDto };

const link = "text-xs font-medium text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400";

/** Pipeline detail loaded per selection (stages with usage counts, rules and requirement options). */
function usePipelineDetail(id: string | null, tick: number) {
  const [state, setState] = useState<{ id: string; data: PipelineDetailDto | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    crmRequest<PipelineDetailDto>(`${PIPELINES_API}/${id}`).then((res) => {
      if (!cancelled) setState({ id, data: res.ok ? res.data : null, error: res.ok ? null : res.error.message });
    });
    return () => {
      cancelled = true;
    };
  }, [id, tick]);
  return state && state.id === id ? state : null;
}

function rulesSummary(s: SettingsStageDto, stages: SettingsStageDto[]) {
  const rules = s.transitionRules ?? [];
  const name = (id: string) => stages.find((x) => x.id === id)?.name ?? "archived stage";
  const blocked = rules.filter((r) => !r.allowed).map((r) => name(r.toStageId));
  const allowed = rules.filter((r) => r.allowed).map((r) => name(r.toStageId));
  if (s.transitionMode === "ONLY_LISTED") return allowed.length ? `Only to ${allowed.join(", ")}` : "No moves allowed";
  return blocked.length ? `Any except ${blocked.join(", ")}` : "Any stage";
}

/**
 * Settings → Pipelines: pipelines (default, archive / restore) and their
 * stages — drag or ↑/↓ to reorder, default probability, default stage,
 * required fields, transition rules, archive with reassignment. Reordering
 * or editing stages never changes which stage an opportunity is in.
 */
export function PipelinesTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload } = useSettingsList<SettingsPipelineDto>("/api/v1/crm/settings/pipelines");
  const [picked, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const selected = picked ?? rows?.find((p) => p.isDefault)?.id ?? rows?.[0]?.id ?? null;
  const detail = usePipelineDetail(selected, tick);
  const pipeline = detail?.data ?? null;
  const refresh = () => {
    reload();
    setTick((t) => t + 1);
    setOrder(null);
  };
  const done = () => {
    setDialog(null);
    refresh();
  };

  const activeStages = (pipeline?.stages ?? []).filter((s) => s.status === "ACTIVE");
  const archivedStages = (pipeline?.stages ?? []).filter((s) => s.status === "ARCHIVED");
  const ordered = order ? order.map((id) => activeStages.find((s) => s.id === id)).filter((s): s is SettingsStageDto => Boolean(s)) : activeStages;

  const saveOrder = async (ids: string[]) => {
    if (!pipeline) return;
    setOrder(ids);
    const res = await crmRequest(`${PIPELINES_API}/${pipeline.id}/stages/reorder`, { method: "POST", body: { ids }, toast: "errors" });
    if (!res.ok) setOrder(null);
    setTick((t) => t + 1);
  };
  const move = (index: number, delta: number) => {
    const ids = ordered.map((s) => s.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + delta, 0, item);
    return saveOrder(ids);
  };
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const ids = ordered.map((s) => s.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(targetId) + (ordered.findIndex((s) => s.id === dragId) < ordered.findIndex((s) => s.id === targetId) ? 1 : 0), 0, dragId);
    setDragId(null);
    return saveOrder(ids);
  };
  const post = async (url: string, body: Record<string, unknown>, successMessage: string) => {
    const res = await crmRequest(url, { method: "POST", body, successMessage });
    if (res.ok) refresh();
  };

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;
  const visiblePipelines = rows.filter((p) => showArchived || p.status === "ACTIVE" || p.id === selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Sales pipelines and their stages. New opportunities start in the default pipeline&apos;s default stage. Required fields and transition rules are checked on every stage change — from the opportunity page, the edit
          form, bulk actions and the API.
        </p>
        {canEdit && <Button onClick={() => setDialog({ kind: "pipeline", pipeline: null })}>Add pipeline</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div className="space-y-2">
          <ul className="space-y-1" aria-label="Pipelines">
            {visiblePipelines.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(p.id);
                    setOrder(null);
                  }}
                  aria-current={p.id === selected ? "true" : undefined}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${p.id === selected ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"} ${p.status === "ARCHIVED" ? "opacity-60" : ""}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.isDefault && <CrmBadge label="Default" tone="green" />}
                    {p.status === "ARCHIVED" && <CrmBadge label="Archived" tone="neutral" />}
                  </span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {p.stages.filter((s) => s.status === "ACTIVE").length} stages · {p.openOpportunityCount} open
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {rows.some((p) => p.status === "ARCHIVED") && (
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived pipelines
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          {!detail ? (
            <CrmLoadingState />
          ) : detail.error || !pipeline ? (
            <CrmErrorState message={detail.error ?? "Pipeline not found."} onRetry={() => setTick((t) => t + 1)} />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    {pipeline.name}
                    {pipeline.isDefault && <CrmBadge label="Default pipeline" tone="green" />}
                    {pipeline.status === "ARCHIVED" && <CrmBadge label="Archived" tone="neutral" />}
                  </h2>
                  {pipeline.description && <p className="text-sm text-zinc-500 dark:text-zinc-400">{pipeline.description}</p>}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {pipeline.openOpportunityCount} open of {pipeline.opportunityCount} opportunities
                  </p>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setDialog({ kind: "pipeline", pipeline })}>
                      Edit
                    </Button>
                    {pipeline.status === "ACTIVE" && !pipeline.isDefault && (
                      <Button variant="secondary" onClick={() => post(`${PIPELINES_API}/${pipeline.id}/default`, { version: pipeline.version }, `"${pipeline.name}" is now the default pipeline.`)}>
                        Make default
                      </Button>
                    )}
                    {pipeline.status === "ACTIVE" ? (
                      <Button variant="secondary" onClick={() => setDialog({ kind: "archive-pipeline", pipeline })}>
                        Archive
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => post(`${PIPELINES_API}/${pipeline.id}/restore`, { version: pipeline.version }, "Pipeline restored.")}>
                        Restore
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      {canEdit && <th className="w-8 px-2 py-2" aria-label="Reorder" />}
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Probability</th>
                      <th className="px-3 py-2">Default</th>
                      <th className="px-3 py-2">Required to enter</th>
                      <th className="px-3 py-2">Moves allowed</th>
                      <th className="px-3 py-2">Opportunities</th>
                      {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {ordered.map((s, i) => (
                      <tr
                        key={s.id}
                        data-testid={`stage-row-${s.name}`}
                        draggable={canEdit}
                        onDragStart={() => setDragId(s.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => dropOn(s.id)}
                        onDragEnd={() => setDragId(null)}
                        className={dragId === s.id ? "bg-indigo-50 opacity-60 dark:bg-indigo-950/40" : ""}
                      >
                        {canEdit && (
                          <td className="cursor-grab px-2 py-2 text-zinc-400" title="Drag to reorder" aria-hidden="true">
                            ⋮⋮
                          </td>
                        )}
                        <td className="px-3 py-2">
                          <span className="font-medium">{s.name}</span>
                          {s.description && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{s.description}</span>}
                        </td>
                        <td className="px-3 py-2">{s.probability === null ? "—" : `${s.probability}%`}</td>
                        <td className="px-3 py-2">
                          {s.isDefault ? (
                            <span className="text-xs font-medium text-green-700 dark:text-green-400">Start stage</span>
                          ) : canEdit && pipeline.status === "ACTIVE" ? (
                            <button type="button" className={link} onClick={() => post(`${PIPELINES_API}/${pipeline.id}/stages/${s.id}/default`, { version: s.version }, `New opportunities now start in "${s.name}".`)}>
                              Make default
                            </button>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">{s.requiredFieldLabels?.length ? s.requiredFieldLabels.join(", ") : <span className="text-zinc-400">Nothing</span>}</td>
                        <td className="px-3 py-2 text-xs">{rulesSummary(s, pipeline.stages)}</td>
                        <td className="px-3 py-2 text-xs">
                          {s.openOpportunityCount ?? 0} open{(s.opportunityCount ?? 0) > (s.openOpportunityCount ?? 0) ? ` · ${s.opportunityCount} total` : ""}
                        </td>
                        {canEdit && (
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            <button type="button" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                              ↑
                            </button>
                            <button type="button" aria-label={`Move ${s.name} down`} disabled={i === ordered.length - 1} onClick={() => move(i, 1)} className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                              ↓
                            </button>
                            <button type="button" className={`ml-2 ${link}`} onClick={() => setDialog({ kind: "stage", stage: s })}>
                              Edit
                            </button>
                            <button type="button" className={`ml-2 ${link}`} onClick={() => setDialog({ kind: "rules", stage: s })}>
                              Rules
                            </button>
                            <button type="button" className={`ml-2 ${link}`} onClick={() => setDialog({ kind: "archive-stage", stage: s })}>
                              Archive
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && pipeline.status === "ACTIVE" && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Drag rows (or use ↑ ↓) to change the order. Opportunities keep their stage.</p>
                  <Button variant="secondary" onClick={() => setDialog({ kind: "stage", stage: null })}>
                    Add stage
                  </Button>
                </div>
              )}
              {archivedStages.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Archived stages</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {archivedStages.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 opacity-70">
                        <span>{s.name}</span>
                        {canEdit && pipeline.status === "ACTIVE" && (
                          <button type="button" className={link} onClick={() => post(`${PIPELINES_API}/${pipeline.id}/stages/${s.id}/restore`, { version: s.version }, "Stage restored.")}>
                            Restore
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {dialog?.kind === "pipeline" && (
        <PipelineModal
          pipeline={dialog.pipeline}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            if (id && !dialog.pipeline) setSelected(id);
            done();
          }}
        />
      )}
      {dialog?.kind === "archive-pipeline" && <ArchivePipelineModal pipeline={dialog.pipeline} pipelines={rows} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === "stage" && pipeline && <StageModal pipeline={pipeline} stage={dialog.stage} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "rules" && pipeline && <TransitionRulesModal pipeline={pipeline} stage={dialog.stage} onClose={() => setDialog(null)} onSaved={done} />}
      {dialog?.kind === "archive-stage" && pipeline && <ArchiveStageModal pipeline={pipeline} stage={dialog.stage} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

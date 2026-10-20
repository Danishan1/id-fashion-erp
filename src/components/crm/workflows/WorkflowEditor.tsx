"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import type { ActionParamDef } from "@/modules/crm/workflows/workflow-action-catalog";
import { emptyGroup, type ConditionGroup } from "@/modules/crm/workflows/workflow-conditions";
import { availableFields, definitionEntity, workflowDefinitionSchema, type WorkflowDefinition, type WorkflowNode } from "@/modules/crm/workflows/workflow-definition";
import { WAIT_UNITS, WEEKDAYS, type NodeType } from "@/modules/crm/workflows/workflow-registry";
import { ConditionBuilder } from "./ConditionBuilder";
import type { DefinitionIssueDto, LookupOption, WorkflowMetaDto } from "./workflow-types";

/**
 * Phase 18 basic editor (no canvas — Phase 19 adds the visual builder).
 * Edits the definition JSON directly through forms: trigger + enrolment
 * conditions, settings, and an ordered list of steps that point to each other
 * by id. A raw JSON view is the fallback for anything the forms don't cover.
 * Nothing here decides validity — the server validates on save / publish.
 */
export function WorkflowEditor({
  value,
  onChange,
  meta,
  issues,
  readOnly,
}: {
  value: WorkflowDefinition;
  onChange: (d: WorkflowDefinition) => void;
  meta: WorkflowMetaDto;
  issues: DefinitionIssueDto[];
  readOnly?: boolean;
}) {
  const [jsonMode, setJsonMode] = useState(false);
  const entity = definitionEntity(value);
  const fields = useMemo(() => availableFields(value, entity ? (meta.customFields[entity] ?? []) : []), [value, entity, meta.customFields]);
  const maxDepth = Number(meta.limits.maxConditionDepth ?? 4);
  const issuesFor = (nodeId?: string, prefix?: string) => issues.filter((i) => (nodeId ? i.nodeId === nodeId : prefix ? i.path.startsWith(prefix) && !i.nodeId : false));
  const set = (patch: Partial<WorkflowDefinition>) => onChange({ ...value, ...patch });
  const setNode = (id: string, node: WorkflowNode) => set({ nodes: value.nodes.map((n) => (n.id === id ? node : n)) });

  const addNode = (type: NodeType) => {
    const used = new Set(value.nodes.map((n) => n.id));
    let i = value.nodes.length + 1;
    while (used.has(`n${i}`)) i++;
    const id = `n${i}`;
    const node: WorkflowNode =
      type === "CONDITION"
        ? { id, type, condition: emptyGroup(), onTrue: null, onFalse: null }
        : type === "BRANCH"
          ? { id, type, branches: [{ id: `${id}_b1`, name: "Branch 1", condition: emptyGroup(), next: null }], defaultNext: null }
          : type === "ACTION"
            ? { id, type, action: meta.actions.find((a) => !entity || a.entities.includes(entity))?.key ?? meta.actions[0].key, params: {}, next: null, onError: "STOP" }
            : type === "WAIT"
              ? { id, type, wait: { mode: "DURATION", amount: 1, unit: "DAYS" }, next: null }
              : type === "GOAL"
                ? { id, type, condition: emptyGroup(), next: null }
                : { id, type };
    // Convenience: attach to the end of the chain (last node with an empty "next").
    const nodes = [...value.nodes];
    const last = nodes.length ? nodes[nodes.length - 1] : null;
    if (last && "next" in last && last.next === null) nodes[nodes.length - 1] = { ...last, next: id } as WorkflowNode;
    onChange({ ...value, nodes: [...nodes, node], entryNodeId: value.entryNodeId ?? id });
  };

  const removeNode = (id: string) => {
    const clear = (x: string | null) => (x === id ? null : x);
    const nodes = value.nodes
      .filter((n) => n.id !== id)
      .map((n): WorkflowNode => {
        switch (n.type) {
          case "CONDITION":
            return { ...n, onTrue: clear(n.onTrue), onFalse: clear(n.onFalse) };
          case "BRANCH":
            return { ...n, defaultNext: clear(n.defaultNext), branches: n.branches.map((b) => ({ ...b, next: clear(b.next) })) };
          case "EXIT":
            return n;
          default:
            return { ...n, next: clear(n.next) };
        }
      });
    onChange({ ...value, nodes, entryNodeId: clear(value.entryNodeId) });
  };

  if (jsonMode) return <JsonEditor value={value} onChange={onChange} readOnly={readOnly} onClose={() => setJsonMode(false)} />;

  const triggerGroups = [...new Set(meta.triggers.map((t) => t.group))];
  const nodeOptions = value.nodes.map((n) => ({ value: n.id, label: `${n.id}${n.name ? ` · ${n.name}` : ""} (${meta.nodeTypes.find((t) => t.key === n.type)?.label ?? n.type})` }));

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="secondary" size="xs" onClick={() => setJsonMode(true)}>
          Edit as JSON
        </Button>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">1. Trigger — when does it start?</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Trigger" htmlFor="wf-trigger">
            <select
              id="wf-trigger"
              disabled={readOnly}
              className={textInputClass()}
              value={value.trigger.type}
              onChange={(e) => set({ trigger: { type: e.target.value, conditions: emptyGroup(), ...(e.target.value === "manual" ? { entityType: "LEAD" } : {}) } })}
            >
              {triggerGroups.map((g) => (
                <optgroup key={g} label={g}>
                  {meta.triggers
                    .filter((t) => t.group === g)
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </FormField>
          {value.trigger.type === "manual" && (
            <FormField label="Runs on" htmlFor="wf-entity">
              <select id="wf-entity" disabled={readOnly} className={textInputClass()} value={value.trigger.entityType ?? ""} onChange={(e) => set({ trigger: { ...value.trigger, entityType: e.target.value, conditions: emptyGroup() } })}>
                {meta.entities.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>
        <p className="text-xs text-zinc-500">{meta.triggers.find((t) => t.key === value.trigger.type)?.description}</p>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Only start when (enrolment conditions)</p>
          <ConditionBuilder value={value.trigger.conditions ?? emptyGroup()} onChange={(g) => set({ trigger: { ...value.trigger, conditions: g } })} fields={fields} lookups={meta.lookups} maxDepth={maxDepth} readOnly={readOnly} />
        </div>
        <IssueList issues={issuesFor(undefined, "trigger")} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">2. Steps</h3>
        <FormField label="First step" htmlFor="wf-entry">
          <NextSelect id="wf-entry" value={value.entryNodeId} options={nodeOptions} onChange={(v) => set({ entryNodeId: v })} readOnly={readOnly} />
        </FormField>
        {!value.nodes.length && <p className="text-sm text-zinc-500">No steps yet. Add one below.</p>}
        {value.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            meta={meta}
            entity={entity}
            fields={fields}
            maxDepth={maxDepth}
            nodeOptions={nodeOptions.filter((o) => o.value !== n.id)}
            issues={issuesFor(n.id)}
            readOnly={readOnly}
            onChange={(node) => setNode(n.id, node)}
            onRemove={() => removeNode(n.id)}
          />
        ))}
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {meta.nodeTypes.map((t) => (
              <Button key={t.key} variant="secondary" size="xs" onClick={() => addNode(t.key as NodeType)} title={t.description}>
                + {t.label}
              </Button>
            ))}
          </div>
        )}
        <IssueList issues={issuesFor(undefined, "nodes").concat(issuesFor(undefined, "entryNodeId"))} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">3. Settings</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Time zone (waits, dates)" htmlFor="wf-tz">
            <input id="wf-tz" disabled={readOnly} className={textInputClass()} value={value.settings.timezone} onChange={(e) => set({ settings: { ...value.settings, timezone: e.target.value } })} />
          </FormField>
          <FormField label="Can a record enter again?" htmlFor="wf-reentry">
            <select id="wf-reentry" disabled={readOnly} className={textInputClass()} value={value.settings.reentry} onChange={(e) => set({ settings: { ...value.settings, reentry: e.target.value as WorkflowDefinition["settings"]["reentry"] } })}>
              {meta.reentryModes.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={readOnly} checked={value.settings.allowWorkflowTriggers} onChange={(e) => set({ settings: { ...value.settings, allowWorkflowTriggers: e.target.checked } })} />
          Let changes made by other workflows start this workflow (off by default — prevents loops)
        </label>
        <div>
          <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Exit the workflow when (checked before every step)</p>
          <ConditionBuilder value={value.settings.exitConditions ?? emptyGroup()} onChange={(g) => set({ settings: { ...value.settings, exitConditions: g.conditions.length ? g : undefined } })} fields={fields} lookups={meta.lookups} maxDepth={maxDepth} readOnly={readOnly} />
        </div>
        <IssueList issues={issuesFor(undefined, "settings")} />
      </section>
    </div>
  );
}

export function IssueList({ issues, tone = "red" }: { issues: DefinitionIssueDto[]; tone?: "red" | "amber" }) {
  if (!issues.length) return null;
  return (
    <ul className={`list-disc space-y-0.5 pl-5 text-xs ${tone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-300"}`}>
      {issues.map((i, k) => (
        <li key={k}>{i.message}</li>
      ))}
    </ul>
  );
}

function NextSelect({ id, value, options, onChange, readOnly }: { id: string; value: string | null; options: LookupOption[]; onChange: (v: string | null) => void; readOnly?: boolean }) {
  return (
    <select id={id} disabled={readOnly} className={textInputClass()} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— end of workflow —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NodeCard({
  node,
  meta,
  entity,
  fields,
  maxDepth,
  nodeOptions,
  issues,
  readOnly,
  onChange,
  onRemove,
}: {
  node: WorkflowNode;
  meta: WorkflowMetaDto;
  entity: string | null;
  fields: Map<string, import("@/modules/crm/workflows/workflow-fields").WorkflowFieldDef>;
  maxDepth: number;
  nodeOptions: LookupOption[];
  issues: DefinitionIssueDto[];
  readOnly?: boolean;
  onChange: (n: WorkflowNode) => void;
  onRemove: () => void;
}) {
  const typeLabel = meta.nodeTypes.find((t) => t.key === node.type)?.label ?? node.type;
  const cond = (g: ConditionGroup, set: (g: ConditionGroup) => void) => <ConditionBuilder value={g} onChange={set} fields={fields} lookups={meta.lookups} maxDepth={maxDepth} readOnly={readOnly} />;
  const next = (label: string, v: string | null, set: (v: string | null) => void) => (
    <FormField label={label} htmlFor={`${node.id}-${label}`}>
      <NextSelect id={`${node.id}-${label}`} value={v} options={nodeOptions} onChange={set} readOnly={readOnly} />
    </FormField>
  );

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${issues.length ? "border-red-300 dark:border-red-800" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">{node.id}</span>
        <span className="text-xs font-semibold uppercase text-zinc-500">{typeLabel}</span>
        <input aria-label="Step name" disabled={readOnly} className={`${textInputClass()} max-w-xs flex-1`} placeholder="Step name (optional)" value={node.name ?? ""} onChange={(e) => onChange({ ...node, name: e.target.value || undefined } as WorkflowNode)} />
        {!readOnly && (
          <Button variant="secondary" size="xs" onClick={onRemove}>
            Delete step
          </Button>
        )}
      </div>

      {node.type === "CONDITION" && (
        <>
          {cond(node.condition, (g) => onChange({ ...node, condition: g }))}
          <div className="grid gap-3 sm:grid-cols-2">
            {next("If yes, go to", node.onTrue, (v) => onChange({ ...node, onTrue: v }))}
            {next("If no, go to", node.onFalse, (v) => onChange({ ...node, onFalse: v }))}
          </div>
        </>
      )}

      {node.type === "BRANCH" && (
        <>
          {node.branches.map((b, i) => (
            <div key={b.id} className="space-y-2 rounded border border-zinc-100 p-2 dark:border-zinc-800">
              <div className="flex gap-2">
                <input aria-label="Branch name" disabled={readOnly} className={textInputClass()} value={b.name} onChange={(e) => onChange({ ...node, branches: node.branches.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                {!readOnly && node.branches.length > 1 && (
                  <Button variant="secondary" size="xs" onClick={() => onChange({ ...node, branches: node.branches.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                )}
              </div>
              {cond(b.condition, (g) => onChange({ ...node, branches: node.branches.map((x, j) => (j === i ? { ...x, condition: g } : x)) }))}
              {next(`${b.name || "Branch"} → go to`, b.next, (v) => onChange({ ...node, branches: node.branches.map((x, j) => (j === i ? { ...x, next: v } : x)) }))}
            </div>
          ))}
          {!readOnly && node.branches.length < 10 && (
            <Button variant="secondary" size="xs" onClick={() => onChange({ ...node, branches: [...node.branches, { id: `${node.id}_b${node.branches.length + 1}_${Date.now() % 1000}`, name: `Branch ${node.branches.length + 1}`, condition: emptyGroup(), next: null }] })}>
              + Branch
            </Button>
          )}
          {next("Otherwise (default) go to", node.defaultNext, (v) => onChange({ ...node, defaultNext: v }))}
        </>
      )}

      {node.type === "ACTION" && <ActionForm node={node} meta={meta} entity={entity} readOnly={readOnly} onChange={onChange} />}
      {node.type === "ACTION" && next("Then go to", node.next, (v) => onChange({ ...node, next: v }))}

      {node.type === "WAIT" && (
        <>
          <WaitForm node={node} fields={fields} readOnly={readOnly} onChange={onChange} />
          {next("Then go to", node.next, (v) => onChange({ ...node, next: v }))}
        </>
      )}

      {node.type === "GOAL" && (
        <>
          <p className="text-xs text-zinc-500">If these match, the execution finishes as &quot;goal reached&quot;; otherwise it continues.</p>
          {cond(node.condition, (g) => onChange({ ...node, condition: g }))}
          {next("If not reached, go to", node.next, (v) => onChange({ ...node, next: v }))}
        </>
      )}

      {node.type === "EXIT" && (
        <FormField label="Reason (shown in the execution trace)" htmlFor={`${node.id}-reason`}>
          <input id={`${node.id}-reason`} disabled={readOnly} className={textInputClass()} value={node.reason ?? ""} onChange={(e) => onChange({ ...node, reason: e.target.value || undefined })} />
        </FormField>
      )}
      <IssueList issues={issues} />
    </div>
  );
}

function WaitForm({ node, fields, readOnly, onChange }: { node: Extract<WorkflowNode, { type: "WAIT" }>; fields: Map<string, { key: string; label: string; type: string }>; readOnly?: boolean; onChange: (n: WorkflowNode) => void }) {
  const w = node.wait;
  const dateFields = [...fields.values()].filter((f) => f.type === "date");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField label="Wait" htmlFor={`${node.id}-mode`}>
        <select
          id={`${node.id}-mode`}
          disabled={readOnly}
          className={textInputClass()}
          value={w.mode}
          onChange={(e) => {
            const mode = e.target.value;
            onChange({ ...node, wait: mode === "DURATION" ? { mode: "DURATION", amount: 1, unit: "DAYS" } : mode === "UNTIL_TIME" ? { mode: "UNTIL_TIME", time: "09:00" } : { mode: "UNTIL_FIELD", field: dateFields[0]?.key ?? "", offsetMinutes: 0 } });
          }}
        >
          <option value="DURATION">For a duration</option>
          <option value="UNTIL_TIME">Until a time of day</option>
          <option value="UNTIL_FIELD">Until a date on the record</option>
        </select>
      </FormField>
      {w.mode === "DURATION" && (
        <>
          <FormField label="Amount" htmlFor={`${node.id}-amount`}>
            <input id={`${node.id}-amount`} type="number" min={1} disabled={readOnly} className={textInputClass()} value={w.amount} onChange={(e) => onChange({ ...node, wait: { ...w, amount: Number(e.target.value) || 1 } })} />
          </FormField>
          <FormField label="Unit" htmlFor={`${node.id}-unit`}>
            <select id={`${node.id}-unit`} disabled={readOnly} className={textInputClass()} value={w.unit} onChange={(e) => onChange({ ...node, wait: { ...w, unit: e.target.value as keyof typeof WAIT_UNITS } })}>
              {Object.keys(WAIT_UNITS).map((u) => (
                <option key={u} value={u}>
                  {u.toLowerCase()}
                </option>
              ))}
            </select>
          </FormField>
        </>
      )}
      {w.mode === "UNTIL_TIME" && (
        <>
          <FormField label="Time (HH:mm)" htmlFor={`${node.id}-time`}>
            <input id={`${node.id}-time`} type="time" disabled={readOnly} className={textInputClass()} value={w.time} onChange={(e) => onChange({ ...node, wait: { ...w, time: e.target.value } })} />
          </FormField>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            {WEEKDAYS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={(w.days ?? []).includes(d)}
                  onChange={(e) => {
                    const days = e.target.checked ? [...(w.days ?? []), d] : (w.days ?? []).filter((x) => x !== d);
                    onChange({ ...node, wait: { ...w, days: days.length ? days : undefined } });
                  }}
                />
                {d}
              </label>
            ))}
            <span className="text-zinc-500">(none = any day)</span>
          </div>
        </>
      )}
      {w.mode === "UNTIL_FIELD" && (
        <>
          <FormField label="Date field" htmlFor={`${node.id}-field`}>
            <select id={`${node.id}-field`} disabled={readOnly} className={textInputClass()} value={w.field} onChange={(e) => onChange({ ...node, wait: { ...w, field: e.target.value } })}>
              <option value="">— choose —</option>
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Offset (minutes, − = before)" htmlFor={`${node.id}-offset`}>
            <input id={`${node.id}-offset`} type="number" disabled={readOnly} className={textInputClass()} value={w.offsetMinutes} onChange={(e) => onChange({ ...node, wait: { ...w, offsetMinutes: Number(e.target.value) || 0 } })} />
          </FormField>
        </>
      )}
    </div>
  );
}

const LOOKUP_FOR_PARAM: Partial<Record<ActionParamDef["type"], string>> = { user: "user", users: "user", tags: "tag", leadStatus: "leadStatus", companyStatus: "companyStatus", stage: "stage", template: "template" };

function ActionForm({ node, meta, entity, readOnly, onChange }: { node: Extract<WorkflowNode, { type: "ACTION" }>; meta: WorkflowMetaDto; entity: string | null; readOnly?: boolean; onChange: (n: WorkflowNode) => void }) {
  const def = meta.actions.find((a) => a.key === node.action);
  const groups = [...new Set(meta.actions.map((a) => a.group))];
  const setParam = (key: string, v: unknown) => {
    const params = { ...node.params };
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete params[key];
    else params[key] = v;
    onChange({ ...node, params });
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Action" htmlFor={`${node.id}-action`}>
          <select id={`${node.id}-action`} disabled={readOnly} className={textInputClass(!def)} value={node.action} onChange={(e) => onChange({ ...node, action: e.target.value, params: {} })}>
            {!def && <option value={node.action}>{node.action} (unknown)</option>}
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {meta.actions
                  .filter((a) => a.group === g)
                  .map((a) => (
                    <option key={a.key} value={a.key} disabled={Boolean(entity) && !a.entities.includes(entity!)}>
                      {a.label}
                      {entity && !a.entities.includes(entity) ? " (not for this record type)" : ""}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </FormField>
        <FormField label="If it fails" htmlFor={`${node.id}-onerror`}>
          <select id={`${node.id}-onerror`} disabled={readOnly} className={textInputClass()} value={node.onError} onChange={(e) => onChange({ ...node, onError: e.target.value as "STOP" | "CONTINUE" })}>
            <option value="STOP">Stop the execution (failed)</option>
            <option value="CONTINUE">Record the error and continue</option>
          </select>
        </FormField>
      </div>
      {def && <p className="text-xs text-zinc-500">{def.description}</p>}
      {def?.params
        .filter((p) => !p.showWhen || p.showWhen.values.includes(String(node.params[p.showWhen.key] ?? "")))
        .map((p) => (
          <FormField key={p.key} label={p.label} htmlFor={`${node.id}-${p.key}`} required={p.required}>
            <ParamInput id={`${node.id}-${p.key}`} param={p} value={node.params[p.key]} lookups={meta.lookups} readOnly={readOnly} onChange={(v) => setParam(p.key, v)} />
            {(p.help || p.interpolate) && <p className="mt-1 text-xs text-zinc-500">{p.help ?? "Merge fields like {{contact.first_name}} are filled in when the step runs."}</p>}
          </FormField>
        ))}
    </div>
  );
}

function ParamInput({ id, param, value, lookups, readOnly, onChange }: { id: string; param: ActionParamDef; value: unknown; lookups: Record<string, LookupOption[]>; readOnly?: boolean; onChange: (v: unknown) => void }) {
  const lookup = LOOKUP_FOR_PARAM[param.type];
  const options = param.options ? param.options.map((o) => ({ value: o.value, label: o.label })) : lookup ? (lookups[lookup] ?? []) : null;
  const [jsonText, setJsonText] = useState(() => (param.type === "json" && value ? JSON.stringify(value, null, 2) : ""));
  const [jsonError, setJsonError] = useState<string | null>(null);
  switch (param.type) {
    case "boolean":
      return <input id={id} type="checkbox" disabled={readOnly} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case "number":
      return <input id={id} type="number" disabled={readOnly} className={textInputClass()} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
    case "textarea":
      return <textarea id={id} rows={4} disabled={readOnly} className={textInputClass()} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "users":
    case "tags":
      return (
        <select id={id} multiple disabled={readOnly} className={textInputClass()} value={Array.isArray(value) ? value.map(String) : []} onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "json":
      return (
        <>
          <textarea
            id={id}
            rows={5}
            disabled={readOnly}
            className={`${textInputClass(Boolean(jsonError))} font-mono text-xs`}
            value={jsonText}
            placeholder={'{ "lead": "{{lead.full_name}}" }'}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={() => {
              if (!jsonText.trim()) {
                setJsonError(null);
                onChange(undefined);
                return;
              }
              try {
                onChange(JSON.parse(jsonText));
                setJsonError(null);
              } catch {
                setJsonError("Not valid JSON.");
              }
            }}
          />
          {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
        </>
      );
    default:
      if (options)
        return (
          <select id={id} disabled={readOnly} className={textInputClass()} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
            <option value="">— choose —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      return <input id={id} type={param.type === "url" ? "url" : "text"} disabled={readOnly} className={textInputClass()} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

function JsonEditor({ value, onChange, readOnly, onClose }: { value: WorkflowDefinition; onChange: (d: WorkflowDefinition) => void; readOnly?: boolean; onClose: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError("Not valid JSON.");
      return;
    }
    const r = workflowDefinitionSchema.safeParse(parsed);
    if (!r.success) {
      setError(r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).slice(0, 8).join("\n"));
      return;
    }
    onChange(r.data);
    onClose();
  };
  return (
    <div className="space-y-2">
      <textarea aria-label="Workflow definition JSON" rows={28} disabled={readOnly} className={`${textInputClass(Boolean(error))} font-mono text-xs`} value={text} onChange={(e) => setText(e.target.value)} />
      {error && <pre className="whitespace-pre-wrap text-xs text-red-600">{error}</pre>}
      <div className="flex gap-2">
        {!readOnly && <Button onClick={apply}>Apply JSON</Button>}
        <Button variant="secondary" onClick={onClose}>
          Back to the form
        </Button>
      </div>
    </div>
  );
}

import { z } from "zod";
import { isValidTimeZone } from "../core/crm-timezone";
import { WORKFLOW_ACTIONS, isWorkflowAction, type ActionParamDef, type WorkflowActionDef } from "./workflow-action-catalog";
import { conditionGroupSchema, emptyGroup, validateConditionGroup, type ConditionGroup, type ConditionIssue } from "./workflow-conditions";
import { WORKFLOW_COMMON_FIELDS, WORKFLOW_RECORD_FIELDS, isWorkflowEntity, type WorkflowEntity, type WorkflowFieldDef } from "./workflow-fields";
import { NODE_TYPE_KEYS, REENTRY_MODES, WAIT_UNITS, WEEKDAYS, WORKFLOW_LIMITS, type NodeType, type ReentryMode } from "./workflow-registry";
import { WORKFLOW_TRIGGERS, WORKFLOW_TRIGGER_KEYS, triggerEntities, type WorkflowTriggerDef, type WorkflowTriggerKey } from "./workflow-triggers";

/**
 * The workflow definition: what a version stores and the engine runs.
 *
 *   { schemaVersion: 1,
 *     trigger: { type, entityType?, conditions },      — when to start (enrolment filter)
 *     entryNodeId,                                      — first node, null = nothing to do
 *     nodes: [ CONDITION | BRANCH | ACTION | WAIT | GOAL | EXIT ],
 *     settings: { timezone, reentry, exitConditions, allowWorkflowTriggers } }
 *
 * Nodes point to the next node by id. The graph must be acyclic (no loops —
 * a loop is the classic runaway automation) and every node reachable from the
 * entry. Phase 19's visual builder serialises into exactly this shape.
 * Client-safe: the editor validates with the same code the server does.
 */

export const WORKFLOW_SCHEMA_VERSION = 1;

const nodeId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, "Node ids: letters, digits, - and _ (max 40).");
const nextRef = nodeId.nullable();
const name = z.string().trim().max(120).optional();

const waitSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("DURATION"), amount: z.number().int().min(1).max(100_000), unit: z.enum(Object.keys(WAIT_UNITS) as [keyof typeof WAIT_UNITS, ...(keyof typeof WAIT_UNITS)[]]) }).strict(),
  z
    .object({
      mode: z.literal("UNTIL_TIME"),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24h)."),
      days: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("UNTIL_FIELD"),
      field: z.string().trim().min(1).max(120),
      /** Minutes after (+) or before (−) the date; past dates continue immediately. */
      offsetMinutes: z.number().int().min(-525_600).max(525_600).default(0),
    })
    .strict(),
]);
export type WaitSpec = z.infer<typeof waitSchema>;

export const conditionNodeSchema = z.object({ id: nodeId, type: z.literal("CONDITION"), name, condition: conditionGroupSchema, onTrue: nextRef, onFalse: nextRef }).strict();
export const branchNodeSchema = z
  .object({
    id: nodeId,
    type: z.literal("BRANCH"),
    name,
    branches: z.array(z.object({ id: nodeId, name: z.string().trim().min(1).max(80), condition: conditionGroupSchema, next: nextRef }).strict()).min(1).max(10),
    defaultNext: nextRef,
  })
  .strict();
export const actionNodeSchema = z
  .object({
    id: nodeId,
    type: z.literal("ACTION"),
    name,
    action: z.string().trim().min(1).max(80),
    params: z.record(z.string(), z.unknown()).default({}),
    next: nextRef,
    /** STOP (default): the execution fails. CONTINUE: the failure is recorded and the next node runs. */
    onError: z.enum(["STOP", "CONTINUE"]).default("STOP"),
  })
  .strict();
export const waitNodeSchema = z.object({ id: nodeId, type: z.literal("WAIT"), name, wait: waitSchema, next: nextRef }).strict();
export const goalNodeSchema = z.object({ id: nodeId, type: z.literal("GOAL"), name, condition: conditionGroupSchema, next: nextRef }).strict();
export const exitNodeSchema = z.object({ id: nodeId, type: z.literal("EXIT"), name, reason: z.string().trim().max(200).optional() }).strict();

export const workflowNodeSchema = z.discriminatedUnion("type", [conditionNodeSchema, branchNodeSchema, actionNodeSchema, waitNodeSchema, goalNodeSchema, exitNodeSchema]);
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowSettingsSchema = z
  .object({
    /** Time zone for waits ("until 09:00") and date maths. */
    timezone: z.string().trim().default("Asia/Kolkata"),
    reentry: z.enum(Object.keys(REENTRY_MODES) as [ReentryMode, ...ReentryMode[]]).default("AFTER_FINISH"),
    /** Checked before every step: when true the execution ends as EXITED. */
    exitConditions: conditionGroupSchema.optional(),
    /** Let changes made by workflows start this workflow (default off — recursion protection). */
    allowWorkflowTriggers: z.boolean().default(false),
  })
  .strict();
export type WorkflowSettings = z.infer<typeof workflowSettingsSchema>;

export const workflowTriggerSchema = z
  .object({
    type: z.string().trim().min(1).max(80),
    /** Manual workflows: the record type they run on. */
    entityType: z.string().optional(),
    /** Enrolment filter: the trigger only starts the workflow when these match. */
    conditions: conditionGroupSchema.optional(),
  })
  .strict();

export const workflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION).default(WORKFLOW_SCHEMA_VERSION),
    trigger: workflowTriggerSchema,
    entryNodeId: nextRef,
    nodes: z.array(workflowNodeSchema).max(WORKFLOW_LIMITS.maxNodes),
    settings: workflowSettingsSchema.default({ timezone: "Asia/Kolkata", reentry: "AFTER_FINISH", allowWorkflowTriggers: false }),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export function emptyDefinition(trigger: WorkflowTriggerKey = "lead.created"): WorkflowDefinition {
  return { schemaVersion: 1, trigger: { type: trigger, conditions: emptyGroup() }, entryNodeId: null, nodes: [], settings: { timezone: "Asia/Kolkata", reentry: "AFTER_FINISH", allowWorkflowTriggers: false } };
}

export interface DefinitionIssue {
  /** "trigger", "settings", "nodes.<id>…" */
  path: string;
  nodeId?: string;
  message: string;
}

/** The record type a definition runs on (null when the trigger is unknown / not chosen). */
export function definitionEntity(def: Pick<WorkflowDefinition, "trigger">): WorkflowEntity | null {
  const key = def.trigger.type as WorkflowTriggerKey;
  if (!(key in WORKFLOW_TRIGGERS)) return null;
  const t = WORKFLOW_TRIGGERS[key] as WorkflowTriggerDef;
  if (t.entity !== "EVENT") return t.entity;
  if (key === "manual") return isWorkflowEntity(def.trigger.entityType) ? def.trigger.entityType : null;
  return null; // tag triggers: any taggable record
}

/** Record types an execution may run on — one for most triggers, several for tag triggers. */
export function definitionEntities(def: Pick<WorkflowDefinition, "trigger">): WorkflowEntity[] {
  const one = definitionEntity(def);
  if (one) return [one];
  const key = def.trigger.type as WorkflowTriggerKey;
  return key in WORKFLOW_TRIGGERS && key !== "manual" ? triggerEntities(key) : [];
}

/**
 * Every field a condition in this workflow may use. For triggers that run on
 * several record types (tags), only fields common to all of them.
 */
export function availableFields(def: Pick<WorkflowDefinition, "trigger">, customFields: readonly WorkflowFieldDef[] = []): Map<string, WorkflowFieldDef> {
  const entities = definitionEntities(def);
  const map = new Map<string, WorkflowFieldDef>();
  if (entities.length) {
    const [first, ...rest] = entities;
    for (const f of WORKFLOW_RECORD_FIELDS[first]) {
      if (rest.every((e) => WORKFLOW_RECORD_FIELDS[e].some((g) => g.key === f.key && g.type === f.type))) map.set(f.key, f);
    }
  }
  const key = def.trigger.type as WorkflowTriggerKey;
  const t = key in WORKFLOW_TRIGGERS ? (WORKFLOW_TRIGGERS[key] as WorkflowTriggerDef) : null;
  for (const f of t?.payloadFields ?? []) map.set(f.key, f);
  for (const f of WORKFLOW_COMMON_FIELDS) map.set(f.key, f);
  if (entities.length === 1) for (const f of customFields) map.set(f.key, f);
  return map;
}

function nextIds(n: WorkflowNode): { label: string; id: string | null }[] {
  switch (n.type) {
    case "CONDITION":
      return [
        { label: "Yes", id: n.onTrue },
        { label: "No", id: n.onFalse },
      ];
    case "BRANCH":
      return [...n.branches.map((b) => ({ label: b.name, id: b.next })), { label: "Default", id: n.defaultNext }];
    case "EXIT":
      return [];
    default:
      return [{ label: "Next", id: n.next }];
  }
}

export function successorsOf(n: WorkflowNode): string[] {
  return nextIds(n)
    .map((x) => x.id)
    .filter((x): x is string => Boolean(x));
}

/** Basic checks of action settings against the catalog (types / required). Deeper checks (ids exist) are server-side. */
export function validateActionParams(def: WorkflowActionDef, params: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const known = new Set(def.params.map((p) => p.key));
  for (const k of Object.keys(params)) if (!known.has(k)) errors.push(`Unknown setting "${k}".`);
  const shown = (p: ActionParamDef) => !p.showWhen || p.showWhen.values.includes(String(params[p.showWhen.key] ?? ""));
  for (const p of def.params) {
    const v = params[p.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (p.required && shown(p)) errors.push(`${p.label} is required.`);
      continue;
    }
    switch (p.type) {
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${p.label} must be a number.`);
        break;
      case "boolean":
        if (typeof v !== "boolean") errors.push(`${p.label} must be yes or no.`);
        break;
      case "tags":
      case "users":
        if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) errors.push(`${p.label} must be a list.`);
        break;
      case "select":
        if (typeof v !== "string" || !(p.options ?? []).some((o) => o.value === v)) errors.push(`${p.label}: choose one of the options.`);
        break;
      case "url":
        if (typeof v !== "string" || !/^https?:\/\//i.test(v)) errors.push(`${p.label} must be a URL.`);
        break;
      case "json":
        if (typeof v !== "object" || Array.isArray(v)) errors.push(`${p.label} must be a JSON object.`);
        break;
      default:
        if (typeof v !== "string") errors.push(`${p.label} must be text.`);
        else if (v.length > (p.type === "textarea" ? 5000 : 500)) errors.push(`${p.label} is too long.`);
    }
  }
  if (def === WORKFLOW_ACTIONS["record.add_tags"] && !(Array.isArray(params.tagIds) && params.tagIds.length) && !(typeof params.tagNames === "string" && params.tagNames.trim())) errors.push("Choose at least one tag.");
  return errors;
}

/**
 * Structural validation: trigger, graph shape (ids, references, reachability,
 * no cycles, an exit path), node settings, conditions and action settings.
 * Returns every issue at once so the editor can show them together.
 */
export function validateDefinitionStructure(def: WorkflowDefinition, customFields: readonly WorkflowFieldDef[] = []): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const push = (path: string, message: string, nodeId?: string) => issues.push({ path, message, ...(nodeId ? { nodeId } : {}) });
  const tkey = def.trigger.type;
  if (!WORKFLOW_TRIGGER_KEYS.includes(tkey as WorkflowTriggerKey)) push("trigger.type", `Unknown trigger "${tkey}".`);
  if (tkey === "manual" && !isWorkflowEntity(def.trigger.entityType)) push("trigger.entityType", "Choose the record type this manual workflow runs on.");
  if (tkey !== "manual" && def.trigger.entityType) push("trigger.entityType", "Only manual workflows choose a record type.");
  if (!isValidTimeZone(def.settings.timezone)) push("settings.timezone", `Unknown time zone "${def.settings.timezone}".`);

  const fields = availableFields(def, customFields);
  const addConditionIssues = (list: ConditionIssue[], nodeIdValue?: string) => list.forEach((i) => push(i.path, i.message, nodeIdValue));
  if (def.trigger.conditions) addConditionIssues(validateConditionGroup(def.trigger.conditions, fields, "trigger.conditions"));
  if (def.settings.exitConditions) addConditionIssues(validateConditionGroup(def.settings.exitConditions, fields, "settings.exitConditions"));

  const byId = new Map<string, WorkflowNode>();
  for (const n of def.nodes) {
    if (byId.has(n.id)) push(`nodes.${n.id}`, `Two nodes have the id "${n.id}".`, n.id);
    byId.set(n.id, n);
  }
  if (!def.nodes.length) push("nodes", "Add at least one step.");
  if (def.entryNodeId && !byId.has(def.entryNodeId)) push("entryNodeId", `The first step "${def.entryNodeId}" doesn't exist.`);
  if (!def.entryNodeId && def.nodes.length) push("entryNodeId", "Choose the first step.");

  const entities = definitionEntities(def);
  for (const n of def.nodes) {
    const base = `nodes.${n.id}`;
    if (!NODE_TYPE_KEYS.includes(n.type as NodeType)) push(base, `Unknown step type.`, n.id);
    for (const { label, id } of nextIds(n)) if (id && !byId.has(id)) push(base, `"${label}" points to a step that doesn't exist (${id}).`, n.id);
    if (n.type === "CONDITION") addConditionIssues(validateConditionGroup(n.condition, fields, `${base}.condition`), n.id);
    if (n.type === "GOAL") addConditionIssues(validateConditionGroup(n.condition, fields, `${base}.condition`), n.id);
    if (n.type === "BRANCH") {
      const ids = new Set<string>();
      n.branches.forEach((b, i) => {
        if (ids.has(b.id)) push(`${base}.branches.${i}`, `Two branches have the id "${b.id}".`, n.id);
        ids.add(b.id);
        addConditionIssues(validateConditionGroup(b.condition, fields, `${base}.branches.${i}.condition`), n.id);
      });
    }
    if (n.type === "WAIT") {
      if (n.wait.mode === "DURATION") {
        const ms = n.wait.amount * WAIT_UNITS[n.wait.unit];
        if (ms > WORKFLOW_LIMITS.maxWaitDays * 86_400_000) push(`${base}.wait`, `A wait can be at most ${WORKFLOW_LIMITS.maxWaitDays} days.`, n.id);
      }
      if (n.wait.mode === "UNTIL_FIELD") {
        const f = fields.get(n.wait.field);
        if (!f || f.type !== "date") push(`${base}.wait.field`, "Choose a date field of the record.", n.id);
      }
      if (n.wait.mode === "UNTIL_TIME" && n.wait.days && !n.wait.days.length) push(`${base}.wait.days`, "Choose at least one day, or leave days empty for any day.", n.id);
    }
    if (n.type === "ACTION") {
      if (!isWorkflowAction(n.action)) {
        push(`${base}.action`, `Unknown action "${n.action}".`, n.id);
        continue;
      }
      const adef = WORKFLOW_ACTIONS[n.action] as WorkflowActionDef;
      const wrong = entities.filter((e) => !adef.entities.includes(e));
      if (entities.length && wrong.length) push(`${base}.action`, `"${adef.label}" can't run on ${wrong.map((e) => e.toLowerCase()).join(" / ")} records.`, n.id);
      for (const m of validateActionParams(adef, n.params)) push(`${base}.params`, m, n.id);
    }
  }

  // Reachability + cycles (depth-first from the entry).
  if (def.entryNodeId && byId.has(def.entryNodeId)) {
    const state = new Map<string, 1 | 2>();
    let cycle: string | null = null;
    const visit = (id: string) => {
      if (cycle) return;
      const s = state.get(id);
      if (s === 1) {
        cycle = id;
        return;
      }
      if (s === 2) return;
      state.set(id, 1);
      const node = byId.get(id);
      if (node) for (const next of successorsOf(node)) if (byId.has(next)) visit(next);
      state.set(id, 2);
    };
    visit(def.entryNodeId);
    if (cycle) push(`nodes.${cycle}`, `Steps loop back to "${cycle}". Workflows can't contain loops.`, cycle);
    for (const n of def.nodes) if (!state.has(n.id)) push(`nodes.${n.id}`, `"${n.name || n.id}" can't be reached from the first step.`, n.id);
  }
  return issues;
}

/** Stable JSON (sorted keys) — the version's content hash is computed from it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** Group conditions used by the trigger, for the "will this record enrol?" check. */
export function triggerConditions(def: WorkflowDefinition): ConditionGroup {
  return def.trigger.conditions ?? emptyGroup();
}

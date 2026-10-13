import { z } from "zod";
import {
  CONDITION_OPERATOR_KEYS,
  CONDITION_OPERATORS,
  DAYS_OPERATORS,
  LIST_OPERATORS,
  VALUELESS_OPERATORS,
  operatorAllowed,
  type ConditionOperator,
  type WorkflowFieldDef,
} from "./workflow-fields";
import { WORKFLOW_LIMITS } from "./workflow-registry";

/**
 * The condition engine: a declarative tree of AND / OR (optionally negated)
 * groups over whitelisted fields. No expressions, no code, no arbitrary
 * paths — a field key is looked up in a flat snapshot the engine builds
 * (workflow-context.ts), so a condition can only see what the registry
 * exposes. Pure functions; client-safe.
 */

export const conditionValueSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.union([z.string().max(200), z.number()])).max(100), z.null()]);

export const conditionLeafSchema = z
  .object({
    kind: z.literal("condition"),
    field: z.string().trim().min(1).max(120),
    operator: z.enum(CONDITION_OPERATOR_KEYS as [ConditionOperator, ...ConditionOperator[]]),
    value: conditionValueSchema.optional(),
  })
  .strict();
export type ConditionLeaf = z.infer<typeof conditionLeafSchema>;

export interface ConditionGroup {
  kind: "group";
  logic: "AND" | "OR";
  negate?: boolean;
  conditions: (ConditionLeaf | ConditionGroup)[];
}

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z
    .object({
      kind: z.literal("group"),
      logic: z.enum(["AND", "OR"]),
      negate: z.boolean().optional(),
      conditions: z.array(z.union([conditionLeafSchema, conditionGroupSchema])).max(WORKFLOW_LIMITS.maxConditions),
    })
    .strict()
);

export function emptyGroup(): ConditionGroup {
  return { kind: "group", logic: "AND", conditions: [] };
}

export interface ConditionIssue {
  path: string;
  message: string;
}

/**
 * Checks fields, operators and values against the fields available for the
 * trigger. `fields` = record + trigger + common + custom fields for this workflow.
 */
export function validateConditionGroup(group: ConditionGroup, fields: ReadonlyMap<string, WorkflowFieldDef>, path = "conditions"): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  let leaves = 0;
  const walk = (g: ConditionGroup, p: string, depth: number) => {
    if (depth > WORKFLOW_LIMITS.maxConditionDepth) {
      issues.push({ path: p, message: `Conditions can be nested at most ${WORKFLOW_LIMITS.maxConditionDepth} levels deep.` });
      return;
    }
    g.conditions.forEach((c, i) => {
      const cp = `${p}.${i}`;
      if (c.kind === "group") return walk(c, cp, depth + 1);
      leaves++;
      const def = fields.get(c.field);
      if (!def) return issues.push({ path: cp, message: `"${c.field}" is not a field this workflow can check.` });
      if (!operatorAllowed(c.operator, def.type)) return issues.push({ path: cp, message: `"${CONDITION_OPERATORS[c.operator].label}" can't be used with ${def.label}.` });
      if (VALUELESS_OPERATORS.has(c.operator)) return;
      const v = c.value;
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return issues.push({ path: cp, message: `Enter a value for "${def.label}".` });
      if (LIST_OPERATORS.has(c.operator) && !Array.isArray(v)) return issues.push({ path: cp, message: `"${CONDITION_OPERATORS[c.operator].label}" needs a list of values.` });
      if (c.operator === "between" && (!Array.isArray(v) || v.length !== 2 || v.some((x) => !isFiniteNumber(x)))) return issues.push({ path: cp, message: "Between needs a minimum and a maximum number." });
      if (DAYS_OPERATORS.has(c.operator) && (!isFiniteNumber(v) || Number(v) < 0 || Number(v) > 3650)) return issues.push({ path: cp, message: "Enter a number of days (0–3650)." });
      if (["gt", "gte", "lt", "lte"].includes(c.operator) && !isFiniteNumber(v)) return issues.push({ path: cp, message: `Enter a number for "${def.label}".` });
      if (["before", "after"].includes(c.operator) || (def.type === "date" && ["eq", "neq"].includes(c.operator))) {
        if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return issues.push({ path: cp, message: `Enter a date for "${def.label}".` });
      }
    });
  };
  walk(group, path, 1);
  if (leaves > WORKFLOW_LIMITS.maxConditions) issues.push({ path, message: `At most ${WORKFLOW_LIMITS.maxConditions} conditions.` });
  return issues;
}

function isFiniteNumber(v: unknown): boolean {
  return (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
}

/** Flat values keyed by field ("record.status" → "uuid", "record.tags" → ["uuid"]). */
export type ConditionSnapshot = Readonly<Record<string, unknown>>;

const DAY_MS = 86_400_000;

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function norm(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim().toLowerCase();
}

/** Evaluates one condition. A missing / unknown field is empty — never an error at run time. */
export function evaluateLeaf(c: ConditionLeaf, snapshot: ConditionSnapshot, now: Date = new Date()): boolean {
  const actual = snapshot[c.field];
  const v = c.value;
  switch (c.operator) {
    case "is_empty":
      return isEmpty(actual);
    case "is_not_empty":
      return !isEmpty(actual);
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false || actual === null || actual === undefined;
    case "has_tag":
      return Array.isArray(actual) && (Array.isArray(v) ? v.some((t) => actual.includes(t)) : actual.includes(v));
    case "not_has_tag":
      return !Array.isArray(actual) || (Array.isArray(v) ? !v.some((t) => actual.includes(t)) : !actual.includes(v));
  }
  if (isEmpty(actual)) return c.operator === "neq" || c.operator === "not_in" || c.operator === "not_contains";
  switch (c.operator) {
    case "eq": {
      const d = asDate(actual);
      if (actual instanceof Date || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && d)) {
        const want = asDate(v);
        return Boolean(d && want && d.toISOString().slice(0, 10) === want.toISOString().slice(0, 10));
      }
      return typeof actual === "number" ? actual === Number(v) : norm(actual) === norm(v);
    }
    case "neq":
      return !evaluateLeaf({ ...c, operator: "eq" }, snapshot, now);
    case "in":
      return Array.isArray(v) && v.some((x) => norm(x) === norm(actual));
    case "not_in":
      return !Array.isArray(v) || !v.some((x) => norm(x) === norm(actual));
    case "contains":
      return norm(actual).includes(norm(v));
    case "not_contains":
      return !norm(actual).includes(norm(v));
    case "starts_with":
      return norm(actual).startsWith(norm(v));
    case "ends_with":
      return norm(actual).endsWith(norm(v));
    case "gt":
      return Number(actual) > Number(v);
    case "gte":
      return Number(actual) >= Number(v);
    case "lt":
      return Number(actual) < Number(v);
    case "lte":
      return Number(actual) <= Number(v);
    case "between": {
      if (!Array.isArray(v) || v.length !== 2) return false;
      const n = Number(actual);
      return n >= Number(v[0]) && n <= Number(v[1]);
    }
    case "before": {
      const a = asDate(actual);
      const b = asDate(v);
      return Boolean(a && b && a.getTime() < b.getTime());
    }
    case "after": {
      const a = asDate(actual);
      const b = asDate(v);
      return Boolean(a && b && a.getTime() > b.getTime());
    }
    case "within_last_days": {
      const a = asDate(actual);
      return Boolean(a && a.getTime() <= now.getTime() && a.getTime() >= now.getTime() - Number(v) * DAY_MS);
    }
    case "within_next_days": {
      const a = asDate(actual);
      return Boolean(a && a.getTime() >= now.getTime() && a.getTime() <= now.getTime() + Number(v) * DAY_MS);
    }
    case "more_than_days_ago": {
      const a = asDate(actual);
      return Boolean(a && a.getTime() < now.getTime() - Number(v) * DAY_MS);
    }
  }
  return false;
}

/** Evaluates a group. An empty group is true (no conditions = always). */
export function evaluateGroup(g: ConditionGroup | null | undefined, snapshot: ConditionSnapshot, now: Date = new Date()): boolean {
  if (!g || g.conditions.length === 0) return g?.negate ? false : true;
  const results = g.conditions.map((c) => (c.kind === "group" ? evaluateGroup(c, snapshot, now) : evaluateLeaf(c, snapshot, now)));
  const value = g.logic === "AND" ? results.every(Boolean) : results.some(Boolean);
  return g.negate ? !value : value;
}

/** Field keys a group reads (to know which snapshot parts to load). */
export function fieldsUsed(g: ConditionGroup | null | undefined, into = new Set<string>()): Set<string> {
  if (!g) return into;
  for (const c of g.conditions) {
    if (c.kind === "group") fieldsUsed(c, into);
    else into.add(c.field);
  }
  return into;
}

/** Human-readable explanation, for execution traces ("Status is Qualified → true"). */
export function explainGroup(g: ConditionGroup | null | undefined, snapshot: ConditionSnapshot, labels: ReadonlyMap<string, string>, now: Date = new Date()): string[] {
  if (!g) return [];
  const lines: string[] = [];
  const walk = (grp: ConditionGroup, indent: string) => {
    lines.push(`${indent}${grp.negate ? "NOT " : ""}${grp.logic === "AND" ? "All of" : "Any of"} → ${evaluateGroup(grp, snapshot, now)}`);
    for (const c of grp.conditions) {
      if (c.kind === "group") walk(c, `${indent}  `);
      else {
        const actual = snapshot[c.field];
        const shown = Array.isArray(actual) ? `[${actual.join(", ")}]` : actual instanceof Date ? actual.toISOString() : actual === undefined || actual === null ? "empty" : String(actual);
        lines.push(`${indent}  ${labels.get(c.field) ?? c.field} ${CONDITION_OPERATORS[c.operator].label}${VALUELESS_OPERATORS.has(c.operator) ? "" : ` ${JSON.stringify(c.value)}`} (is ${shown}) → ${evaluateLeaf(c, snapshot, now)}`);
      }
    }
  };
  walk(g, "");
  return lines;
}

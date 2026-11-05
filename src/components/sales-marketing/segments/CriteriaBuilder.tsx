"use client";

import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import {
  CRITERIA_LIMITS,
  OPERATORS,
  SEGMENT_FIELDS,
  fieldDef,
  operatorsFor,
  validateCondition,
  type OperatorKey,
  type SegmentCondition,
  type SegmentCriteria,
  type SegmentFieldDef,
  type SegmentSourceKey,
} from "@/modules/sales-marketing/segments/segment-registry";
import type { LookupOptions } from "./segment-ui";

const small = `${textInputClass()} !py-1 text-sm`;

/** Default value for a field + operator so the condition is never in an undefined shape. */
function defaultValue(field: SegmentFieldDef, op: OperatorKey): unknown {
  const arity = OPERATORS[op].arity;
  if (arity === 0) return undefined;
  if (arity === "list") return [];
  if (op === "between") return field.type === "date" ? ["", ""] : [0, 0];
  if (op === "in_last_days" || op === "not_in_last_days") return 30;
  if (field.type === "number") return 0;
  return "";
}

function ValueInput({ field, cond, lookups, onChange }: { field: SegmentFieldDef; cond: SegmentCondition; lookups: LookupOptions; onChange: (v: unknown) => void }) {
  const arity = OPERATORS[cond.operator].arity;
  if (arity === 0) return null;
  if (arity === "list") {
    const options = field.options ?? (field.lookup ? (lookups[field.lookup] ?? []) : []);
    const selected = new Set(Array.isArray(cond.value) ? (cond.value as string[]) : []);
    return (
      <select
        multiple
        aria-label={`${field.label} values`}
        value={[...selected]}
        onChange={(e) => onChange(Array.from(e.target.selectedOptions).map((o) => o.value))}
        className={`${small} min-h-[4.5rem] min-w-[12rem]`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (cond.operator === "in_last_days" || cond.operator === "not_in_last_days") {
    return <input type="number" aria-label="Days" min={1} max={3650} value={String(cond.value ?? "")} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} className={`${small} w-24`} />;
  }
  const type = field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
  const conv = (v: string) => (type === "number" ? (v === "" ? "" : Number(v)) : v);
  if (cond.operator === "between") {
    const pair = Array.isArray(cond.value) ? (cond.value as unknown[]) : ["", ""];
    return (
      <span className="flex items-center gap-1">
        <input type={type} aria-label="From" value={String(pair[0] ?? "")} onChange={(e) => onChange([conv(e.target.value), pair[1]])} className={`${small} w-36`} />
        <span className="text-xs text-zinc-500">and</span>
        <input type={type} aria-label="To" value={String(pair[1] ?? "")} onChange={(e) => onChange([pair[0], conv(e.target.value)])} className={`${small} w-36`} />
      </span>
    );
  }
  return <input type={type} aria-label="Value" maxLength={CRITERIA_LIMITS.textLength} value={String(cond.value ?? "")} onChange={(e) => onChange(conv(e.target.value))} className={`${small} w-48`} />;
}

/**
 * Rules editor: groups of conditions; groups combined with ALL / ANY, each
 * group's conditions with its own ALL / ANY (one level — no deeper nesting).
 * Only the source's allow-listed fields and their operators are offered;
 * problems are shown inline, but the server re-validates everything.
 */
export function CriteriaBuilder({ source, value, onChange, lookups, disabled, emptyHint }: { source: SegmentSourceKey; value: SegmentCriteria; onChange: (c: SegmentCriteria) => void; lookups: LookupOptions; disabled?: boolean; emptyHint: string }) {
  const fields = SEGMENT_FIELDS[source];
  const setGroup = (gi: number, patch: Partial<SegmentCriteria["groups"][number]>) => onChange({ ...value, groups: value.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });
  const setCond = (gi: number, ci: number, c: SegmentCondition) => setGroup(gi, { conditions: value.groups[gi].conditions.map((x, i) => (i === ci ? c : x)) });
  const newCond = (): SegmentCondition => {
    const f = fields[0];
    const op = operatorsFor(f)[0];
    return { field: f.key, operator: op, value: defaultValue(f, op) };
  };

  return (
    <div className="space-y-3">
      {value.groups.length === 0 && <p className="text-sm text-zinc-500">{emptyHint}</p>}
      {value.groups.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          Records must match
          <select disabled={disabled} value={value.match} onChange={(e) => onChange({ ...value, match: e.target.value as "ALL" | "ANY" })} className={`${small} !w-auto`}>
            <option value="ALL">all groups</option>
            <option value="ANY">any group</option>
          </select>
        </label>
      )}
      {value.groups.map((g, gi) => (
        <div key={gi} className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
              Group {gi + 1}: match
              <select disabled={disabled} value={g.match} onChange={(e) => setGroup(gi, { match: e.target.value as "ALL" | "ANY" })} className={`${small} !w-auto normal-case`}>
                <option value="ALL">all conditions</option>
                <option value="ANY">any condition</option>
              </select>
            </label>
            {!disabled && (
              <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onChange({ ...value, groups: value.groups.filter((_, i) => i !== gi) })}>
                Remove group
              </button>
            )}
          </div>
          {g.conditions.map((c, ci) => {
            const field = fieldDef(source, c.field);
            const check = validateCondition(source, c);
            return (
              <div key={ci} className="flex flex-wrap items-start gap-2">
                <select
                  aria-label="Field"
                  disabled={disabled}
                  value={c.field}
                  onChange={(e) => {
                    const f = fieldDef(source, e.target.value)!;
                    const op = operatorsFor(f)[0];
                    setCond(gi, ci, { field: f.key, operator: op, value: defaultValue(f, op) });
                  }}
                  className={`${small} !w-auto`}
                >
                  {!field && <option value={c.field}>{c.field} (not available)</option>}
                  {fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                {field && (
                  <select
                    aria-label="Comparison"
                    disabled={disabled}
                    value={c.operator}
                    onChange={(e) => {
                      const op = e.target.value as OperatorKey;
                      setCond(gi, ci, { field: c.field, operator: op, value: OPERATORS[op].arity === OPERATORS[c.operator].arity && op !== "between" && c.operator !== "between" ? c.value : defaultValue(field, op) });
                    }}
                    className={`${small} !w-auto`}
                  >
                    {operatorsFor(field).map((op) => (
                      <option key={op} value={op}>
                        {OPERATORS[op].label}
                      </option>
                    ))}
                  </select>
                )}
                {field && !disabled && <ValueInput field={field} cond={c} lookups={lookups} onChange={(v) => setCond(gi, ci, { ...c, value: v })} />}
                {field && disabled && OPERATORS[c.operator].arity !== 0 && <span className="text-sm text-zinc-600">{Array.isArray(c.value) ? (c.value as unknown[]).join(", ") : String(c.value ?? "")}</span>}
                {!disabled && (
                  <button type="button" aria-label="Remove condition" className="px-1 text-zinc-400 hover:text-red-600" onClick={() => setGroup(gi, { conditions: g.conditions.filter((_, i) => i !== ci) })}>
                    ✕
                  </button>
                )}
                {!check.ok && <span className="w-full text-xs text-red-600 dark:text-red-400">{check.message}</span>}
                {field?.hint && <span className="w-full text-xs text-zinc-500">{field.hint}</span>}
              </div>
            );
          })}
          {!disabled && g.conditions.length < CRITERIA_LIMITS.conditionsPerGroup && (
            <Button size="xs" variant="secondary" onClick={() => setGroup(gi, { conditions: [...g.conditions, newCond()] })}>
              + Condition
            </Button>
          )}
        </div>
      ))}
      {!disabled && value.groups.length < CRITERIA_LIMITS.groups && (
        <Button size="xs" variant="secondary" onClick={() => onChange({ ...value, groups: [...value.groups, { match: "ALL", conditions: [newCond()] }] })}>
          + Group
        </Button>
      )}
    </div>
  );
}

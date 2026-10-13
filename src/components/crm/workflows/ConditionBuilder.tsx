"use client";

import { Button } from "@/components/ui/Button";
import { textInputClass } from "@/components/ui/FormField";
import type { ConditionGroup, ConditionLeaf } from "@/modules/crm/workflows/workflow-conditions";
import { CONDITION_OPERATORS, CONDITION_OPERATOR_KEYS, DAYS_OPERATORS, LIST_OPERATORS, VALUELESS_OPERATORS, operatorAllowed, type ConditionOperator, type WorkflowFieldDef } from "@/modules/crm/workflows/workflow-fields";
import type { LookupOption } from "./workflow-types";

/**
 * Phase 18 condition builder: AND / OR groups, optional NOT, nested up to the
 * engine's depth limit. Fields and operators come from the same whitelist the
 * server validates against — there is no free-form expression.
 */
export function ConditionBuilder({
  value,
  onChange,
  fields,
  lookups,
  depth = 0,
  maxDepth = 4,
  readOnly,
}: {
  value: ConditionGroup;
  onChange: (g: ConditionGroup) => void;
  fields: Map<string, WorkflowFieldDef>;
  lookups: Record<string, LookupOption[]>;
  depth?: number;
  maxDepth?: number;
  readOnly?: boolean;
}) {
  const fieldList = [...fields.values()];
  const update = (i: number, item: ConditionLeaf | ConditionGroup) => onChange({ ...value, conditions: value.conditions.map((c, j) => (j === i ? item : c)) });
  const remove = (i: number) => onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) });
  const addLeaf = () => {
    const f = fieldList[0];
    if (!f) return;
    const op = CONDITION_OPERATOR_KEYS.find((o) => operatorAllowed(o, f.type)) ?? "is_not_empty";
    onChange({ ...value, conditions: [...value.conditions, { kind: "condition", field: f.key, operator: op, value: VALUELESS_OPERATORS.has(op) ? undefined : "" }] });
  };
  const addGroup = () => onChange({ ...value, conditions: [...value.conditions, { kind: "group", logic: value.logic === "AND" ? "OR" : "AND", conditions: [] }] });

  return (
    <div className={`space-y-2 rounded-md border p-2 ${depth ? "border-dashed border-zinc-300 dark:border-zinc-700" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" disabled={readOnly} checked={Boolean(value.negate)} onChange={(e) => onChange({ ...value, negate: e.target.checked })} /> NOT
        </label>
        <select aria-label="Match" disabled={readOnly} className={textInputClass()} style={{ width: "auto" }} value={value.logic} onChange={(e) => onChange({ ...value, logic: e.target.value as "AND" | "OR" })}>
          <option value="AND">All of these (AND)</option>
          <option value="OR">Any of these (OR)</option>
        </select>
        {!value.conditions.length && <span className="text-zinc-500">No conditions — always matches.</span>}
      </div>
      {value.conditions.map((c, i) =>
        c.kind === "group" ? (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1">
              <ConditionBuilder value={c} onChange={(g) => update(i, g)} fields={fields} lookups={lookups} depth={depth + 1} maxDepth={maxDepth} readOnly={readOnly} />
            </div>
            {!readOnly && (
              <Button variant="secondary" size="xs" onClick={() => remove(i)}>
                Remove
              </Button>
            )}
          </div>
        ) : (
          <LeafRow key={i} leaf={c} fields={fieldList} lookups={lookups} readOnly={readOnly} onChange={(l) => update(i, l)} onRemove={() => remove(i)} />
        )
      )}
      {!readOnly && (
        <div className="flex gap-2">
          <Button variant="secondary" size="xs" onClick={addLeaf} disabled={!fieldList.length}>
            + Condition
          </Button>
          {depth + 1 < maxDepth && (
            <Button variant="secondary" size="xs" onClick={addGroup}>
              + Group
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function optionsFor(field: WorkflowFieldDef | undefined, lookups: Record<string, LookupOption[]>): LookupOption[] | null {
  if (!field) return null;
  if (field.options?.length) return field.options.map((o) => ({ value: o.value, label: o.label }));
  if (field.lookup && lookups[field.lookup]) return lookups[field.lookup];
  return null;
}

function LeafRow({ leaf, fields, lookups, readOnly, onChange, onRemove }: { leaf: ConditionLeaf; fields: WorkflowFieldDef[]; lookups: Record<string, LookupOption[]>; readOnly?: boolean; onChange: (l: ConditionLeaf) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.key === leaf.field);
  const ops = field ? CONDITION_OPERATOR_KEYS.filter((o) => operatorAllowed(o, field.type)) : CONDITION_OPERATOR_KEYS;
  const op = leaf.operator as ConditionOperator;
  const opts = optionsFor(field, lookups);
  const setField = (key: string) => {
    const f = fields.find((x) => x.key === key);
    const nextOp = f && operatorAllowed(op, f.type) ? op : (CONDITION_OPERATOR_KEYS.find((o) => f && operatorAllowed(o, f.type)) ?? "is_not_empty");
    onChange({ kind: "condition", field: key, operator: nextOp, value: VALUELESS_OPERATORS.has(nextOp) ? undefined : "" });
  };
  const setOp = (o: ConditionOperator) => onChange({ ...leaf, operator: o, value: VALUELESS_OPERATORS.has(o) ? undefined : LIST_OPERATORS.has(o) ? [] : DAYS_OPERATORS.has(o) ? 7 : typeof leaf.value === "string" || typeof leaf.value === "number" ? leaf.value : "" });

  let valueInput: React.ReactNode = null;
  if (!VALUELESS_OPERATORS.has(op)) {
    if (DAYS_OPERATORS.has(op) || (field?.type === "number" && !LIST_OPERATORS.has(op))) {
      valueInput = <input aria-label="Value" disabled={readOnly} type="number" className={textInputClass()} value={typeof leaf.value === "number" ? leaf.value : String(leaf.value ?? "")} onChange={(e) => onChange({ ...leaf, value: e.target.value === "" ? null : Number(e.target.value) })} />;
    } else if (LIST_OPERATORS.has(op)) {
      const list = Array.isArray(leaf.value) ? leaf.value.map(String) : [];
      valueInput = opts ? (
        <select aria-label="Values" multiple disabled={readOnly} className={textInputClass()} value={list} onChange={(e) => onChange({ ...leaf, value: [...e.target.selectedOptions].map((o) => o.value) })}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label="Values (comma separated)"
          disabled={readOnly}
          className={textInputClass()}
          placeholder={op === "between" ? "min, max" : "a, b, c"}
          value={list.join(", ")}
          onChange={(e) => {
            const parts = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange({ ...leaf, value: field?.type === "number" ? parts.map(Number) : parts });
          }}
        />
      );
    } else if (opts) {
      valueInput = (
        <select aria-label="Value" disabled={readOnly} className={textInputClass()} value={String(leaf.value ?? "")} onChange={(e) => onChange({ ...leaf, value: e.target.value })}>
          <option value="">— choose —</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    } else {
      valueInput = <input aria-label="Value" disabled={readOnly} type={field?.type === "date" ? "date" : "text"} className={textInputClass()} value={String(leaf.value ?? "")} onChange={(e) => onChange({ ...leaf, value: e.target.value })} />;
    }
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <select aria-label="Field" disabled={readOnly} className={textInputClass(!field)} value={leaf.field} onChange={(e) => setField(e.target.value)}>
        {!field && <option value={leaf.field}>{leaf.field} (unknown)</option>}
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
      <select aria-label="Operator" disabled={readOnly} className={textInputClass()} value={op} onChange={(e) => setOp(e.target.value as ConditionOperator)}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {CONDITION_OPERATORS[o].label}
          </option>
        ))}
      </select>
      <div>{valueInput}</div>
      {!readOnly ? (
        <Button variant="secondary" size="xs" onClick={onRemove}>
          Remove
        </Button>
      ) : (
        <span />
      )}
    </div>
  );
}

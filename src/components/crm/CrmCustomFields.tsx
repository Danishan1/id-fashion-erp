"use client";

import { FormField, textInputClass } from "@/components/ui/FormField";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { formatCurrency } from "@/lib/currency";
import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";

export type CustomFieldFormValues = Record<string, unknown>;

/** Converts a stored ISO datetime to the value a datetime-local input expects (local time). */
function toLocalInput(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Renders inputs for the active custom-field definitions of one entity type.
 * Same component for Lead now and Contact/Company/Opportunity later.
 */
export function CrmCustomFieldInputs({
  definitions,
  values,
  onChange,
  errors = {},
}: {
  definitions: CrmCustomFieldDefinitionDto[];
  values: CustomFieldFormValues;
  onChange: (key: string, value: unknown) => void;
  errors?: Record<string, string>;
}) {
  const active = definitions.filter((d) => d.isActive);
  if (!active.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {active.map((d) => {
        const id = `cf-${d.key}`;
        const value = values[d.key];
        const error = errors[`customFields.${d.key}`];
        const common = { id, className: textInputClass(Boolean(error)), "aria-describedby": d.description ? `${id}-help` : undefined };
        let input;
        switch (d.fieldType) {
          case "TEXTAREA":
            input = <textarea {...common} rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(d.key, e.target.value)} />;
            break;
          case "NUMBER":
          case "DECIMAL":
          case "CURRENCY":
            input = (
              <input
                {...common}
                type="number"
                step={d.fieldType === "NUMBER" ? 1 : d.fieldType === "CURRENCY" ? 0.01 : "any"}
                value={value === undefined || value === null ? "" : String(value)}
                onChange={(e) => onChange(d.key, e.target.value === "" ? null : e.target.value)}
              />
            );
            break;
          case "DATE":
            input = <input {...common} type="date" value={(value as string) ?? ""} onChange={(e) => onChange(d.key, e.target.value || null)} />;
            break;
          case "DATETIME":
            input = (
              <input
                {...common}
                type="datetime-local"
                value={toLocalInput(value)}
                onChange={(e) => onChange(d.key, e.target.value ? new Date(e.target.value).toISOString() : null)}
              />
            );
            break;
          case "BOOLEAN":
            input = (
              <select {...common} value={value === true ? "true" : value === false ? "false" : ""} onChange={(e) => onChange(d.key, e.target.value === "" ? null : e.target.value === "true")}>
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            );
            break;
          case "DROPDOWN":
            input = (
              <select {...common} value={(value as string) ?? ""} onChange={(e) => onChange(d.key, e.target.value || null)}>
                <option value="">— Select —</option>
                {(d.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          case "MULTI_SELECT": {
            const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
            input = (
              <div id={id} role="group" aria-label={d.label} className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
                {(d.options ?? []).map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={selected.has(o.value)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(o.value)) next.delete(o.value);
                        else next.add(o.value);
                        onChange(d.key, [...next]);
                      }}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            );
            break;
          }
          default:
            input = (
              <input
                {...common}
                type={d.fieldType === "EMAIL" ? "email" : d.fieldType === "URL" ? "url" : d.fieldType === "PHONE" ? "tel" : "text"}
                value={(value as string) ?? ""}
                onChange={(e) => onChange(d.key, e.target.value)}
              />
            );
        }
        return (
          <FormField key={d.key} label={d.label} htmlFor={id} required={d.isRequired} error={error}>
            {input}
            {d.description && (
              <p id={`${id}-help`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {d.description}
              </p>
            )}
          </FormField>
        );
      })}
    </div>
  );
}

export function formatCustomFieldValue(d: CrmCustomFieldDefinitionDto, value: unknown): string {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
  const label = (v: string) => d.options?.find((o) => o.value === v)?.label ?? v;
  switch (d.fieldType) {
    case "BOOLEAN":
      return value ? "Yes" : "No";
    case "DATE":
      return formatDate(`${value}T00:00:00`);
    case "DATETIME":
      return formatDateTime(String(value));
    case "CURRENCY":
      return formatCurrency(Number(value));
    case "DROPDOWN":
      return label(String(value));
    case "MULTI_SELECT":
      return (value as string[]).map(label).join(", ");
    default:
      return String(value);
  }
}

/** Read-only list of custom-field values (inactive fields still show if they hold data). */
export function CrmCustomFieldValues({ definitions, values }: { definitions: CrmCustomFieldDefinitionDto[]; values: CustomFieldFormValues }) {
  const shown = definitions.filter((d) => d.isActive || (values[d.key] !== undefined && values[d.key] !== null));
  if (!shown.length) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No custom fields are set up for leads. Admins can add them in CRM Settings.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {shown.map((d) => (
        <div key={d.key}>
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">
            {d.label}
            {!d.isActive && " (archived field)"}
          </dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{formatCustomFieldValue(d, values[d.key])}</dd>
        </div>
      ))}
    </dl>
  );
}

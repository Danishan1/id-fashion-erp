"use client";

import { useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import {
  CHOICE_FIELD_TYPES,
  CRM_CUSTOM_FIELD_TYPE_LABELS,
  CRM_CUSTOM_FIELD_TYPES,
  type CrmCustomFieldDefinitionDto,
  type CrmCustomFieldOption,
} from "@/modules/crm/custom-fields/crm-custom-field-types";
import { keyFromName } from "@/modules/crm/settings/crm-settings.schema";
import { useSettingsList } from "./useSettingsList";

const URL_BASE = "/api/v1/crm/settings/custom-fields";
type FieldType = CrmCustomFieldDefinitionDto["fieldType"];

function OptionsEditor({ options, onChange, lockedValues }: { options: CrmCustomFieldOption[]; onChange: (o: CrmCustomFieldOption[]) => void; lockedValues: Set<string> }) {
  const [label, setLabel] = useState("");
  const add = () => {
    const l = label.trim();
    if (!l) return;
    let value = keyFromName(l);
    let n = 2;
    while (options.some((o) => o.value === value)) value = `${keyFromName(l)}_${n++}`;
    onChange([...options, { value, label: l }]);
    setLabel("");
  };
  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <ul className="space-y-1">
          {options.map((o, i) => (
            <li key={o.value} className="flex items-center gap-2">
              <label htmlFor={`opt-${o.value}`} className="sr-only">
                Option {i + 1}
              </label>
              <input id={`opt-${o.value}`} className={textInputClass()} value={o.label} maxLength={100} onChange={(e) => onChange(options.map((x) => (x.value === o.value ? { ...x, label: e.target.value } : x)))} />
              {!lockedValues.has(o.value) && (
                <button type="button" aria-label={`Remove ${o.label}`} className="px-2 text-zinc-500 hover:text-red-600" onClick={() => onChange(options.filter((x) => x.value !== o.value))}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <label htmlFor="opt-new" className="sr-only">
          New option
        </label>
        <input
          id="opt-new"
          className={textInputClass()}
          placeholder="Add an option…"
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" onClick={add} disabled={!label.trim()}>
          Add
        </Button>
      </div>
      {lockedValues.size > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">Saved options can be renamed but not removed, so existing values stay readable.</p>}
    </div>
  );
}

function FieldModal({ field, onClose, onSaved }: { field: CrmCustomFieldDefinitionDto | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(field?.label ?? "");
  const [key, setKey] = useState(field?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(Boolean(field));
  const [fieldType, setFieldType] = useState<FieldType>(field?.fieldType ?? "TEXT");
  const [description, setDescription] = useState(field?.description ?? "");
  const [options, setOptions] = useState<CrmCustomFieldOption[]>(field?.options ?? []);
  const [isRequired, setIsRequired] = useState(field?.isRequired ?? false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isChoice = CHOICE_FIELD_TYPES.includes(fieldType);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = field
      ? { label, description, isRequired, ...(isChoice ? { options } : {}) }
      : { entityType: "LEAD", label, key: key || undefined, fieldType, description, isRequired, ...(isChoice ? { options } : {}) };
    const res = await crmRequest(field ? `${URL_BASE}/${field.id}` : URL_BASE, { method: field ? "PATCH" : "POST", body, successMessage: field ? "Field updated." : "Field added." });
    setBusy(false);
    if (!res.ok) {
      setErrors(res.error.fieldErrors);
      if (!Object.keys(res.error.fieldErrors).length) setFormError(res.error.message);
      return;
    }
    onSaved();
  };

  return (
    <Modal open onClose={onClose} title={field ? `Edit "${field.label}"` : "Add lead custom field"} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="mt-4 space-y-4">
        <FormField label="Label" htmlFor="cf-label" required error={errors.label}>
          <input
            id="cf-label"
            className={textInputClass(Boolean(errors.label))}
            value={label}
            maxLength={80}
            required
            autoFocus
            onChange={(e) => {
              setLabel(e.target.value);
              if (!keyTouched) setKey(e.target.value ? keyFromName(e.target.value) : "");
            }}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Key" htmlFor="cf-key" error={errors.key}>
            <input
              id="cf-key"
              className={`${textInputClass(Boolean(errors.key))} font-mono`}
              value={key}
              maxLength={50}
              disabled={Boolean(field)}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Type" htmlFor="cf-type" required error={errors.fieldType}>
            <select id="cf-type" className={textInputClass()} value={fieldType} disabled={Boolean(field)} onChange={(e) => setFieldType(e.target.value as FieldType)}>
              {CRM_CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CRM_CUSTOM_FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {field && <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">Key and type are fixed once a field exists, so stored values stay valid.</p>}
        <FormField label="Help text" htmlFor="cf-desc" error={errors.description}>
          <input id="cf-desc" className={textInputClass()} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {isChoice && (
          <FormField label="Options" htmlFor="opt-new" required error={errors.options}>
            <OptionsEditor options={options} onChange={setOptions} lockedValues={new Set((field?.options ?? []).map((o) => o.value))} />
          </FormField>
        )}
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
          Required on the lead form
        </label>
        {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy} loadingLabel="Saving…">
            {field ? "Save" : "Add field"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CustomFieldsTab({ canEdit }: { canEdit: boolean }) {
  const { rows, error, reload, setRows } = useSettingsList<CrmCustomFieldDefinitionDto>(`${URL_BASE}?entityType=LEAD`);
  const [editing, setEditing] = useState<CrmCustomFieldDefinitionDto | "new" | null>(null);

  const toggle = async (f: CrmCustomFieldDefinitionDto) => {
    const res = await crmRequest(`${URL_BASE}/${f.id}`, { method: "PATCH", body: { isActive: !f.isActive }, successMessage: f.isActive ? "Field archived." : "Field restored." });
    if (res.ok) reload();
  };

  const move = async (index: number, delta: number) => {
    if (!rows) return;
    const next = [...rows];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setRows(next);
    // Renumber every field so the order is stable even if old sortOrders collide.
    const results = await Promise.all(next.map((f, i) => (f.sortOrder === i * 10 ? null : crmRequest(`${URL_BASE}/${f.id}`, { method: "PATCH", body: { sortOrder: i * 10 }, toast: "errors" }))));
    if (results.some((r) => r && !r.ok)) reload();
    else setRows(next.map((f, i) => ({ ...f, sortOrder: i * 10 })));
  };

  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!rows) return <CrmLoadingState />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Extra fields on every lead, shown in this order on the form and detail page. Archived fields keep their stored values.</p>
        {canEdit && <Button onClick={() => setEditing("new")}>Add field</Button>}
      </div>
      {rows.length === 0 ? (
        <CrmEmptyState title="No custom fields yet" description="Add fields like Order quantity, Fabric preference or Target price to capture what your team needs." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Required</th>
                <th className="px-3 py-2">Active</th>
                {canEdit && <th className="px-3 py-2 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((f, i) => (
                <tr key={f.id} className={f.isActive ? "" : "opacity-60"}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{f.label}</span>
                    {f.options && f.options.length > 0 && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{f.options.map((o) => o.label).join(", ")}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">{f.key}</td>
                  <td className="px-3 py-2">{CRM_CUSTOM_FIELD_TYPE_LABELS[f.fieldType]}</td>
                  <td className="px-3 py-2">{f.isRequired ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <ToggleSwitch checked={f.isActive} disabled={!canEdit} label={`${f.label} active`} onToggle={() => toggle(f)} />
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100">
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${f.label} down`}
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                        className="px-1.5 text-zinc-500 hover:text-zinc-900 disabled:opacity-30 dark:hover:text-zinc-100"
                      >
                        ↓
                      </button>
                      <button type="button" className="ml-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setEditing(f)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <FieldModal
          field={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

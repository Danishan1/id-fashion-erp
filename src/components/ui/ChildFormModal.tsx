"use client";

import { useEffect, useState, type FormEvent } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { suggestCodeFromName } from "@/lib/code-suggest";
import { buildSubmitPayload, emptyValues, type LookupField } from "@/components/ui/SimpleLookupManager";

interface ChildFormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: LookupField[];
  /** Omit for create (fields start empty); pass the row's own values for edit. */
  initialValues?: Record<string, unknown>;
  /** Required unless `onSubmitLocal` is given — the fetch-backed submit path. */
  submitUrl?: string;
  method?: "POST" | "PATCH";
  onSuccess: (data: unknown) => void;
  submitLabel?: string;
  /** Prepended to the auto-suggested Code when a "name" field changes and "code" hasn't been touched yet — same convention as SimpleLookupManager. */
  codePrefix?: string;
  /**
   * When given, submit never hits the network — the built payload is handed
   * straight to this callback (then `onSuccess`), for staging a child record
   * client-side before its parent exists yet (e.g. Warehouse's own Create
   * modal building up a locations list before the warehouse has an id).
   * `submitUrl`/`method` are ignored when this is present.
   */
  onSubmitLocal?: (payload: Record<string, string>) => void;
}

/**
 * Generic Add/Edit form modal for a flat, declaratively-configured record —
 * the form half of SimpleLookupManager, extracted so it can be reused both
 * standalone and inside ManageChildrenModal/ChildrenList (its list half), or
 * inside LocalChildrenList via `onSubmitLocal` when there's no parent id yet
 * to submit against. Shares the exact same LookupField config shape and
 * buildSubmitPayload/emptyValues helpers so a field set behaves identically
 * whether it's a global lookup or a child record's own Add/Edit form.
 */
export function ChildFormModal({
  open,
  onClose,
  title,
  fields,
  initialValues,
  submitUrl,
  method,
  onSuccess,
  submitLabel,
  codePrefix = "",
  onSubmitLocal,
}: ChildFormModalProps) {
  const hasCodeField = fields.some((f) => f.key === "code");
  // Lazily initialized from `initialValues` — the caller is expected to pass
  // a `key` that changes on every open (see ManageChildrenModal's own
  // `formRevision` counter) so this component fully remounts per open,
  // re-running these initializers with fresh data instead of needing an
  // effect to reset state (this project's established remount-via-key
  // convention, avoiding a react-hooks/set-state-in-effect violation).
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValues ? buildSubmitPayload(fields, initialValues) : emptyValues(fields)
  );
  const [isCodeManuallyEdited, setIsCodeManuallyEdited] = useState(() => Boolean(initialValues));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string; label: string }[]>>({});

  useEffect(() => {
    fields
      .filter((f) => f.type === "select" && f.optionsUrl)
      .forEach((f) => {
        fetch(`${f.optionsUrl}${f.optionsUrl!.includes("?") ? "&" : "?"}pageSize=200`)
          .then((res) => res.json())
          .then((body) =>
            setDynamicOptions((prev) => ({
              ...prev,
              [f.key]: (body.data ?? []).map((row: { id: string; name?: string; code?: string }) => ({
                value: row.id,
                label: String(row.name ?? row.code ?? row.id),
              })),
            }))
          )
          .catch(() => setDynamicOptions((prev) => ({ ...prev, [f.key]: [] })));
      });
    // Runs once per mount — the caller remounts this component fresh on
    // every open (see the class doc comment above), so there's no need to
    // re-trigger this on an `open` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Fields whose showWhen condition no longer holds get their own value
   * cleared in the same update — otherwise a "Please specify" note typed
   * while materialCategory=OTHER would silently survive (unsubmitted-but-
   * still-there) after switching to a different category, only to reappear
   * if the user picks OTHER again later in the same form session. */
  const clearStaleDependents = (next: Record<string, string>): Record<string, string> => {
    let result = next;
    for (const f of fields) {
      if (f.showWhen && next[f.showWhen.field] !== f.showWhen.equals && next[f.key]) {
        result = { ...result, [f.key]: "" };
      }
    }
    return result;
  };

  const handleFieldChange = (key: string, value: string) => {
    if (key === "code") {
      setIsCodeManuallyEdited(true);
      setValues((prev) => ({ ...prev, code: value }));
      return;
    }
    if (key === "name" && hasCodeField && !isCodeManuallyEdited) {
      setValues((prev) => ({ ...prev, name: value, code: suggestCodeFromName(value, codePrefix) }));
      return;
    }
    setValues((prev) => clearStaleDependents({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const payload = buildSubmitPayload(fields, values);

    if (onSubmitLocal) {
      onSubmitLocal(payload);
      onSuccess(payload);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await fetch(submitUrl!, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save.");
      return;
    }

    const body = await res.json().catch(() => null);
    onSuccess(body?.data);
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {fields
          .filter((f) => !f.showWhen || values[f.showWhen.field] === f.showWhen.equals)
          .map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {f.label}
              {f.required && <span className="text-red-500"> *</span>}
            </label>
            {f.type === "select" ? (
              <select
                required={f.required}
                value={values[f.key] ?? ""}
                onChange={(e) => handleFieldChange(f.key, e.target.value)}
                className={textInputClass()}
              >
                <option value="">{f.placeholder ?? "— Select —"}</option>
                {(f.options ?? dynamicOptions[f.key] ?? []).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={f.type ?? "text"}
                required={f.required}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => handleFieldChange(f.key, e.target.value)}
                className={textInputClass()}
              />
            )}
          </div>
        ))}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : (submitLabel ?? (initialValues ? "Update" : "Add"))}
          </button>
        </div>
      </form>
    </Modal>
  );
}

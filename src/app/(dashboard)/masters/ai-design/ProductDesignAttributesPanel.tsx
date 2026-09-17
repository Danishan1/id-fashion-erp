"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon, PlusIcon } from "@/components/ui/icons";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { PRODUCT_CATEGORIES_BY_CUSTOMER } from "@/core/ai-designer/catalogs/customer-catalog";
import { OptionPhotoUploadControl } from "./OptionPhotoUploadControl";

interface AttributeRow {
  id: string;
  categoryName: string;
  attributeKey: string;
  attributeLabel: string;
  options: string[];
  sortOrder: number;
  isActive: boolean;
}

const KNOWN_CATEGORIES = [...new Set(Object.values(PRODUCT_CATEGORIES_BY_CUSTOMER).flat())].sort();

const EMPTY_FORM = { categoryName: "", attributeKey: "", attributeLabel: "", optionsText: "" };

function parseOptions(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * Was a hardcoded, code-only catalog (design-attribute-catalog.ts) — now a
 * real, per-company editable master. The wizard's own Product Design step
 * reads through GET /product-design-attributes/effective, which returns
 * this company's real rows for a category the moment ANY exist for it,
 * falling back to the original built-in defaults otherwise (see
 * ai-designer-attribute-master.service.ts) — so a category with nothing
 * customized here keeps working exactly as before, with zero setup.
 */
export function ProductDesignAttributesPanel() {
  const [attributes, setAttributes] = useState<AttributeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pendingToggle, setPendingToggle] = useState<AttributeRow | null>(null);
  // { optionValue -> attachmentId } for whichever options already have an
  // uploaded photo override — fetched once so the Add/Edit modal's own
  // per-option photo controls (below the Options textarea) can show
  // Upload/Replace correctly without a separate round-trip per option.
  const [referenceImages, setReferenceImages] = useState<Record<string, string>>({});

  const reload = async () => {
    const body = await parseJson(await fetch("/api/v1/ai-designer/product-design-attributes"));
    setAttributes(body.data);
  };

  const reloadReferenceImages = async () => {
    const body = await parseJson(await fetch("/api/v1/ai-designer/product-design-attributes/reference-images"));
    const map: Record<string, string> = {};
    for (const row of body.data ?? []) {
      if (row.attachmentId) map[row.optionValue] = row.attachmentId;
    }
    setReferenceImages(map);
  };

  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes")
      .then(parseJson)
      .then((body) => setAttributes(body.data))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes/reference-images")
      .then(parseJson)
      .then((body) => {
        const map: Record<string, string> = {};
        for (const row of body.data ?? []) {
          if (row.attachmentId) map[row.optionValue] = row.attachmentId;
        }
        setReferenceImages(map);
      })
      .catch(() => setReferenceImages({}));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, AttributeRow[]>();
    for (const attr of attributes ?? []) {
      map.set(attr.categoryName, [...(map.get(attr.categoryName) ?? []), attr]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [attributes]);

  const customizedCategories = new Set(groups.map(([category]) => category));
  const uncustomizedKnownCategories = KNOWN_CATEGORIES.filter((c) => !customizedCategories.has(c));

  const openCreate = (categoryName?: string) => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, categoryName: categoryName ?? "" });
    setModalOpen(true);
  };

  const openEdit = (attr: AttributeRow) => {
    setEditingId(attr.id);
    setForm({
      categoryName: attr.categoryName,
      attributeKey: attr.attributeKey,
      attributeLabel: attr.attributeLabel,
      optionsText: attr.options.join(", "),
    });
    setModalOpen(true);
  };

  const submitForm = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = parseOptions(form.optionsText);
      if (editingId) {
        await parseJson(
          await fetch(`/api/v1/ai-designer/product-design-attributes/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attributeLabel: form.attributeLabel, options }),
          })
        );
      } else {
        await parseJson(
          await fetch("/api/v1/ai-designer/product-design-attributes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              categoryName: form.categoryName,
              attributeKey: form.attributeKey,
              attributeLabel: form.attributeLabel,
              options,
            }),
          })
        );
      }
      setModalOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setBusy(true);
    try {
      await parseJson(
        await fetch(`/api/v1/ai-designer/product-design-attributes/${pendingToggle.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !pendingToggle.isActive }),
        })
      );
      setPendingToggle(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!attributes) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Categories with no rows here (below) keep using the built-in default attributes/options —
          add even one row for a category to fully take over its list.
        </p>
        <button
          type="button"
          onClick={() => openCreate()}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          + Add Attribute
        </button>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No categories customized yet — every Product Category is using its built-in default attributes.
        </p>
      )}

      {groups.map(([category, rows]) => (
        <div key={category} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{category}</h3>
            <RowAction icon={<PlusIcon />} label="Add Attribute" onClick={() => openCreate(category)} />
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((attr) => (
              <div key={attr.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {attr.attributeLabel} <span className="text-xs font-normal text-zinc-400">({attr.attributeKey})</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{attr.options.join(", ")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <RowAction icon={<EditIcon />} label="Edit" onClick={() => openEdit(attr)} />
                  <ToggleSwitch checked={attr.isActive} onToggle={() => setPendingToggle(attr)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {uncustomizedKnownCategories.length > 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Not yet customized (still using built-in defaults) — click one to start customizing it:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {uncustomizedKnownCategories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => openCreate(c)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Attribute" : "Add Attribute"}>
        <div className="space-y-3">
          <FormField label="Category" htmlFor="pdCategory" required>
            <input
              id="pdCategory"
              list="pd-known-categories"
              disabled={!!editingId}
              className={textInputClass()}
              value={form.categoryName}
              onChange={(e) => setForm({ ...form, categoryName: e.target.value })}
              placeholder="e.g. Dress"
            />
            <datalist id="pd-known-categories">
              {KNOWN_CATEGORIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
          <FormField label="Key" htmlFor="pdKey" required error={!editingId && form.attributeKey && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(form.attributeKey) ? "Single camelCase word, e.g. neckline" : undefined}>
            <input
              id="pdKey"
              disabled={!!editingId}
              className={textInputClass()}
              value={form.attributeKey}
              onChange={(e) => setForm({ ...form, attributeKey: e.target.value })}
              placeholder="e.g. neckline"
            />
          </FormField>
          <FormField label="Label" htmlFor="pdLabel" required>
            <input
              id="pdLabel"
              className={textInputClass()}
              value={form.attributeLabel}
              onChange={(e) => setForm({ ...form, attributeLabel: e.target.value })}
              placeholder="e.g. Neckline"
            />
          </FormField>
          <FormField label="Options" htmlFor="pdOptions" required>
            <textarea
              id="pdOptions"
              rows={3}
              className={textInputClass()}
              value={form.optionsText}
              onChange={(e) => setForm({ ...form, optionsText: e.target.value })}
              placeholder="Round Neck, V-Neck, Halter, Off-Shoulder"
            />
            <p className="mt-1 text-xs text-zinc-400">Comma or newline separated.</p>
          </FormField>

          {parseOptions(form.optionsText).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Reference Photos (optional)</p>
              <p className="mb-2 text-xs text-zinc-400">
                Upload a real photo per option now, or leave blank to use the AI-generated photo (or clipart icon).
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {parseOptions(form.optionsText).map((opt) => (
                  <OptionPhotoUploadControl
                    key={opt}
                    optionValue={opt}
                    attachmentId={referenceImages[opt] ?? null}
                    onChanged={() => void reloadReferenceImages()}
                  />
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={busy || !form.categoryName.trim() || !form.attributeLabel.trim() || !parseOptions(form.optionsText).length || (!editingId && !form.attributeKey.trim())}
            onClick={submitForm}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>

      <ConfirmModal
        open={pendingToggle !== null}
        title={pendingToggle?.isActive ? `Deactivate "${pendingToggle.attributeLabel}"?` : `Activate "${pendingToggle?.attributeLabel}"?`}
        message={
          pendingToggle?.isActive
            ? "This attribute will stop appearing in the Product Design step for new selections."
            : "This attribute will appear in the Product Design step again."
        }
        confirmLabel={pendingToggle?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pendingToggle?.isActive)}
        isBusy={busy}
        onConfirm={confirmToggle}
        onCancel={() => setPendingToggle(null)}
      />
    </div>
  );
}

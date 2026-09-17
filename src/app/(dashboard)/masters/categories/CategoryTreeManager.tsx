"use client";

import { useEffect, useState, type ReactNode } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { RowAction } from "@/components/ui/RowAction";
import { EditIcon, PlusIcon } from "@/components/ui/icons";
import { suggestCodeFromName } from "@/lib/code-suggest";
import {
  buildCategoryTree,
  buildCategoryOptions,
  filterCategoryTree,
  getCategoryAncestorPath,
  type FlatCategory,
  type CategoryTreeNode,
} from "@/lib/category-tree";

const EMPTY_FORM = { code: "", name: "", parentCategoryId: "" };

/**
 * Tree view with expand/collapse for the recursive Garment Category master —
 * replaces SimpleLookupManager on just this one tab (Category is the only
 * garment-attribute entity with a parent/child hierarchy; the other 7 stay on
 * the generic flat-list manager). Fetches the full flat list once and builds
 * the tree client-side (see src/lib/category-tree.ts) — a company's category
 * count never approaches a scale where that stops being fast enough.
 */
export function CategoryTreeManager() {
  const [categories, setCategories] = useState<FlatCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FlatCategory | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isCodeManuallyEdited, setIsCodeManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<FlatCategory | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [search, setSearch] = useState("");

  const load = () => {
    setIsLoading(true);
    fetch("/api/v1/categories?pageSize=500")
      .then((res) => res.json())
      .then((body) => setCategories(body.data ?? []))
      .catch(() => setCategories([]))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(load, 0);
    return () => clearTimeout(timeout);
  }, []);

  const tree = buildCategoryTree(categories);
  const isSearching = search.trim().length > 0;
  const displayTree = isSearching ? filterCategoryTree(tree, search.trim()) : tree;

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openAddRoot = () => {
    setEditingCategory(null);
    setForm(EMPTY_FORM);
    setIsCodeManuallyEdited(false);
    setError(null);
    setShowForm(true);
  };

  const openAddSubcategory = (parent: FlatCategory) => {
    setEditingCategory(null);
    setForm({ code: "", name: "", parentCategoryId: parent.id });
    setIsCodeManuallyEdited(false);
    setError(null);
    setShowForm(true);
  };

  const openEdit = (category: FlatCategory) => {
    setEditingCategory(category);
    setForm({ code: category.code, name: category.name, parentCategoryId: category.parentCategoryId ?? "" });
    setIsCodeManuallyEdited(true);
    setError(null);
    setShowForm(true);
  };

  const handleNameChange = (name: string) => {
    setForm((prev) => ({ ...prev, name, code: isCodeManuallyEdited ? prev.code : suggestCodeFromName(name) }));
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    const url = editingCategory ? `/api/v1/categories/${editingCategory.id}` : "/api/v1/categories";
    const method = editingCategory ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        name: form.name,
        parentCategoryId: form.parentCategoryId,
        isActive: editingCategory ? editingCategory.isActive : true,
      }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save category.");
      return;
    }

    setShowForm(false);
    load();
  };

  const confirmToggleActive = async () => {
    if (!pendingToggle) return;
    setIsToggling(true);

    const res = await fetch(`/api/v1/categories/${pendingToggle.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: pendingToggle.code,
        name: pendingToggle.name,
        parentCategoryId: pendingToggle.parentCategoryId ?? "",
        isActive: !pendingToggle.isActive,
      }),
    });

    setIsToggling(false);
    setPendingToggle(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to update status.");
      return;
    }

    load();
  };

  const parentOptions = buildCategoryOptions(categories, editingCategory?.id);
  const ancestorPath = form.parentCategoryId ? getCategoryAncestorPath(categories, form.parentCategoryId) : [];

  const renderNode = (node: CategoryTreeNode): ReactNode => {
    const hasChildren = node.children.length > 0;
    // While searching, every node stays expanded regardless of its own
    // collapsed state — otherwise a match could be hidden behind a
    // collapsed ancestor the user never explicitly opened.
    const isCollapsed = !isSearching && collapsed.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
          style={{ paddingLeft: `${node.depth * 20 + 8}px` }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(node.id)}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
                className="w-4 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                {isCollapsed ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">{node.name}</span>
            <span className="shrink-0 text-xs text-zinc-400">({node.code})</span>
            {!node.isActive && <span className="shrink-0 text-xs text-zinc-400">(inactive)</span>}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            <RowAction icon={<PlusIcon />} label="Add Subcategory" onClick={() => openAddSubcategory(node)} />
            <RowAction icon={<EditIcon />} label="Edit" onClick={() => openEdit(node)} />
            <ToggleSwitch
              checked={node.isActive}
              onToggle={() => setPendingToggle(node)}
              label={node.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
            />
          </div>
        </div>
        {hasChildren && !isCollapsed && <div>{node.children.map((child) => renderNode(child))}</div>}
      </div>
    );
  };

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className={`${textInputClass()} max-w-xs`}
        />
        <button onClick={openAddRoot} className="shrink-0 text-sm font-medium text-indigo-600 hover:text-indigo-500">
          + Add Root Category
        </button>
      </div>

      {error && !showForm && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        {isLoading && <p className="px-2 py-4 text-center text-sm text-zinc-500">Loading…</p>}
        {!isLoading && displayTree.length === 0 && (
          <p className="px-2 py-4 text-center text-sm text-zinc-500">
            {isSearching ? "No categories match your search." : "No categories yet."}
          </p>
        )}
        {!isLoading && displayTree.map((node) => renderNode(node))}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingCategory ? "Edit Category" : form.parentCategoryId ? "Add Subcategory" : "Add Root Category"}
      >
        <div className="space-y-3">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          {ancestorPath.length > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{ancestorPath.join(" › ")}</p>
          )}
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Code</label>
            <input
              required
              value={form.code}
              onChange={(e) => {
                setIsCodeManuallyEdited(true);
                setForm({ ...form, code: e.target.value });
              }}
              className={textInputClass()}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</label>
            <input required value={form.name} onChange={(e) => handleNameChange(e.target.value)} className={textInputClass()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">Parent Category</label>
            <select
              value={form.parentCategoryId}
              onChange={(e) => setForm({ ...form, parentCategoryId: e.target.value })}
              className={textInputClass()}
            >
              <option value="">— None (root category) —</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isSubmitting ? "Saving…" : editingCategory ? "Update" : "Add"}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={pendingToggle !== null}
        title={pendingToggle?.isActive ? "Deactivate category?" : "Activate category?"}
        message={
          pendingToggle?.isActive
            ? `"${pendingToggle?.name}" will be deactivated and hidden from active selection lists. You can reactivate it later.`
            : `"${pendingToggle?.name}" will be marked active again.`
        }
        confirmLabel={pendingToggle?.isActive ? "Deactivate" : "Activate"}
        isDangerous={Boolean(pendingToggle?.isActive)}
        isBusy={isToggling}
        onConfirm={confirmToggleActive}
        onCancel={() => setPendingToggle(null)}
      />
    </div>
  );
}

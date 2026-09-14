"use client";

import { useEffect, useMemo, useState } from "react";
import { OptionPhotoUploadControl } from "./OptionPhotoUploadControl";

interface ReferenceImageRow {
  optionValue: string;
  attachmentId: string | null;
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * Masters -> AI Design -> Product Design -> Reference Photos. Lets an admin
 * upload a real photo per option VALUE (e.g. "Deep Back Cut-Out") that
 * supersedes the AI-generated static photo in the Product Design wizard
 * step — useful whenever no image-generation provider currently has
 * credits, or an admin simply wants a specific, curated photo instead of
 * whatever the AI produced. Every known option value across the whole
 * catalog (built-in + this company's own customized attributes) is listed,
 * whether or not it has an override yet — search narrows a ~200-value list
 * down to something browsable. The same per-option upload/reset control
 * (OptionPhotoUploadControl) is also embedded directly in the Product
 * Design tab's own Add/Edit Attribute modal, so a brand-new option doesn't
 * need a separate trip here just to get its first photo.
 */
export function OptionReferenceImagesPanel() {
  const [rows, setRows] = useState<ReferenceImageRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const body = await parseJson(await fetch("/api/v1/ai-designer/product-design-attributes/reference-images"));
    setRows(body.data);
  };

  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes/reference-images")
      .then(parseJson)
      .then((body) => setRows(body.data))
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) => r.optionValue.toLowerCase().includes(q));
  }, [rows, search]);

  if (!rows) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Upload a real photo for any Product Design option below — it overrides the AI-generated reference photo
        immediately, with no image-generation provider or credits needed. Options with no upload here keep using the
        AI-generated photo (or the clipart icon, if neither exists yet).
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search options (e.g. 'back', 'collar')…"
        className="w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      <p className="text-xs text-zinc-400">
        {filtered.length} of {rows.length} option{rows.length === 1 ? "" : "s"}
        {search && " matching"}
      </p>

      {filtered.length === 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">No options match your search.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((row) => (
          <OptionPhotoUploadControl key={row.optionValue} optionValue={row.optionValue} attachmentId={row.attachmentId} onChanged={reload} />
        ))}
      </div>
    </div>
  );
}

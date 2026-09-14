"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DesignOptionImage } from "@/core/ai-designer/catalogs/design-icon-catalog";

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
 * down to something browsable.
 */
export function OptionReferenceImagesPanel() {
  const [rows, setRows] = useState<ReferenceImageRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyValue, setBusyValue] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

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

  const handleUpload = async (optionValue: string, file: File) => {
    setBusyValue(optionValue);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("optionValue", optionValue);
      formData.append("file", file);
      await parseJson(await fetch("/api/v1/ai-designer/product-design-attributes/reference-images", { method: "POST", body: formData }));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusyValue(null);
    }
  };

  const handleReset = async (optionValue: string) => {
    setBusyValue(optionValue);
    setError(null);
    try {
      await parseJson(
        await fetch("/api/v1/ai-designer/product-design-attributes/reference-images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionValue }),
        })
      );
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusyValue(null);
    }
  };

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
          <div
            key={row.optionValue}
            className="flex flex-col items-center gap-1.5 rounded-md border border-zinc-200 p-2.5 text-center dark:border-zinc-800"
          >
            <DesignOptionImage value={row.optionValue} overrideAttachmentId={row.attachmentId} />
            <p className="text-xs font-medium leading-tight text-zinc-900 dark:text-zinc-100">{row.optionValue}</p>
            {row.attachmentId && <p className="text-[10px] text-indigo-600 dark:text-indigo-400">Custom photo uploaded</p>}
            <input
              ref={(el) => {
                fileInputs.current[row.optionValue] = el;
              }}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(row.optionValue, file);
                e.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyValue === row.optionValue}
                onClick={() => fileInputs.current[row.optionValue]?.click()}
                className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
              >
                {busyValue === row.optionValue ? "Working…" : row.attachmentId ? "Replace" : "Upload"}
              </button>
              {row.attachmentId && (
                <button
                  type="button"
                  disabled={busyValue === row.optionValue}
                  onClick={() => handleReset(row.optionValue)}
                  className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-50"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

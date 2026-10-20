"use client";

import { useEffect, useMemo, useState } from "react";
import { SKETCH_STRUCTURE_OPTIONS } from "@/core/ai-designer/catalogs/sketch-structure-catalog";
import { OptionPhotoUploadControl } from "./OptionPhotoUploadControl";

interface FlatRow {
  optionValue: string;
  attachmentId: string | null;
}

const BASE = "/api/v1/ai-designer/product-design-attributes/reference-images";

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * Masters -> AI Design -> Construction Flats. The small CAD line-drawing
 * shown on each construction option (A-Line, V-Neck, ...) on the AI Designer
 * edit page. "Generate missing photos" creates them with AI a few at a time
 * (one request per batch, so nothing runs for minutes); any one can be
 * uploaded or replaced by hand. Options without a photo show their clipart icon.
 */
export function ConstructionFlatsPanel() {
  const [rows, setRows] = useState<FlatRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const reload = async () => {
    const body = await parseJson(await fetch(`${BASE}?variant=CAD_FLAT`));
    setRows(body.data);
  };

  useEffect(() => {
    fetch(`${BASE}?variant=CAD_FLAT`)
      .then(parseJson)
      .then((body) => setRows(body.data))
      .catch((e) => setError(e.message));
  }, []);

  const byValue = useMemo(() => new Map((rows ?? []).map((r) => [r.optionValue, r.attachmentId])), [rows]);
  const total = rows?.length ?? 0;
  const done = (rows ?? []).filter((r) => r.attachmentId).length;

  async function generateMissing() {
    setGenerating(true);
    setError(null);
    let failedTotal = 0;
    try {
      // One short request per batch; stop when nothing is left or a batch makes no progress.
      for (let round = 0; round < 30; round++) {
        const body = await parseJson(await fetch(`${BASE}/generate-flats`, { method: "POST", headers: { "x-toast": "errors" } }));
        const { generated, failed, remaining, total: all } = body.data as {
          generated: string[];
          failed: { value: string }[];
          remaining: number;
          total: number;
        };
        failedTotal += failed.length;
        setProgress(`${all - remaining} of ${all} photos ready`);
        await reload();
        if (remaining === 0 || generated.length === 0) break;
      }
      if (failedTotal > 0) setError(`${failedTotal} photo(s) could not be generated — try again, or upload them by hand.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  if (!rows) return <p className="text-sm text-zinc-500 dark:text-zinc-400">{error ?? "Loading…"}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          The CAD sketch photo shown on each construction option in the AI Designer edit page. Generate the missing ones
          with AI, or upload your own. Options without a photo show their clipart icon.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{progress ?? `${done} of ${total} photos ready`}</span>
          <button
            type="button"
            disabled={generating || done === total}
            onClick={generateMissing}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? "Generating…" : done === total ? "All photos ready" : "✨ Generate missing photos"}
          </button>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      {SKETCH_STRUCTURE_OPTIONS.map((group) => (
        <section key={group.category}>
          <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <span className="mr-1">{group.icon}</span>
            {group.label}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {group.options.map((value) => (
              <OptionPhotoUploadControl
                key={value}
                optionValue={value}
                attachmentId={byValue.get(value) ?? null}
                onChanged={reload}
                variant="CAD_FLAT"
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

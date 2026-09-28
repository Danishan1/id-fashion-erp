"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { getApiErrorMessage } from "@/lib/api-client";

interface StageInfo {
  id: string;
  code: string;
  name: string;
  sequence: number;
  isActive: boolean;
}

interface StyleRow {
  stage: StageInfo;
  cost: number | null;
}

interface DesignRow {
  stage: StageInfo;
  styleDefault: number | null;
  designCost: number | null;
  effective: number | null;
  source: "STYLE_DEFAULT" | "DESIGN_OVERRIDE" | "NOT_CONFIGURED";
}

type Props =
  | { mode: "style"; url: string; canEdit: boolean; onSaved?: () => void }
  | { mode: "design"; url: string; canEdit: boolean; onSaved?: () => void };

const SOURCE_LABEL: Record<DesignRow["source"], string> = {
  STYLE_DEFAULT: "Style default",
  DESIGN_OVERRIDE: "Design override",
  NOT_CONFIGURED: "Not configured",
};

function toInput(v: number | null) {
  return v === null ? "" : String(v);
}

/**
 * Stage-wise job-work cost editor.
 *  - "style": one default cost per production stage for a Master Style.
 *  - "design": each stage shows the inherited Style default; typing a value
 *    overrides it for this Design only, clearing it reverts to the Style
 *    default (so later Style changes flow through again).
 * Saves every row in one request; the API writes them in one transaction.
 */
export function StageCostEditor(props: Props) {
  const [styleRows, setStyleRows] = useState<StyleRow[] | null>(null);
  const [designRows, setDesignRows] = useState<DesignRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const apply = (data: { stages: (StyleRow | DesignRow)[] }) => {
    if (props.mode === "style") {
      const rows = data.stages as StyleRow[];
      setStyleRows(rows);
      setDraft(Object.fromEntries(rows.map((r) => [r.stage.id, toInput(r.cost)])));
    } else {
      const rows = data.stages as DesignRow[];
      setDesignRows(rows);
      setDraft(Object.fromEntries(rows.map((r) => [r.stage.id, toInput(r.designCost)])));
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(props.url)
      .then(async (res) => {
        if (!res.ok) throw new Error(await getApiErrorMessage(res, "Could not load stage costs."));
        return res.json();
      })
      .then((body) => {
        if (!cancelled) apply(body.data);
      })
      .catch((err: Error) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.url]);

  const invalid = Object.entries(draft).find(([, v]) => v !== "" && (Number.isNaN(Number(v)) || Number(v) < 0));

  const save = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const res = await fetch(props.url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-toast-success": "Stage costs updated successfully." },
        body: JSON.stringify({
          costs: Object.entries(draft).map(([productionStageId, v]) => ({
            productionStageId,
            cost: v === "" ? null : Number(v),
          })),
        }),
      });
      if (!res.ok) {
        setSaveError(await getApiErrorMessage(res, "Failed to save stage costs."));
        return;
      }
      const body = await res.json();
      apply(body.data);
      setSavedAt(Date.now());
      props.onSaved?.();
    } catch {
      setSaveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loadError) return <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>;
  const rowsLoaded = props.mode === "style" ? styleRows : designRows;
  if (!rowsLoaded) return <p className="text-sm text-zinc-500">Loading stage costs…</p>;
  if (rowsLoaded.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No active production stages configured yet (Masters → Production Configuration).
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {props.mode === "style"
          ? "Default external job-work cost per piece for each stage. Designs of this style inherit these unless they override a stage."
          : "Leave a stage blank to inherit the Style default; enter a value to override it for this design only. Already-issued job work keeps the cost it was issued at."}
      </p>
      <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <th className="px-3 py-2 font-medium">Stage</th>
              {props.mode === "design" && <th className="px-3 py-2 font-medium">Style Default</th>}
              <th className="px-3 py-2 font-medium">{props.mode === "style" ? "Default Cost (₹/pc)" : "Design Cost (₹/pc)"}</th>
              {props.mode === "design" && <th className="px-3 py-2 font-medium">Effective</th>}
            </tr>
          </thead>
          <tbody>
            {rowsLoaded.map((row) => {
              const id = row.stage.id;
              const value = draft[id] ?? "";
              const design = props.mode === "design" ? (row as DesignRow) : null;
              const effective = design ? (value !== "" ? Number(value) : design.styleDefault) : null;
              const effectiveSource: DesignRow["source"] | null = design
                ? value !== ""
                  ? "DESIGN_OVERRIDE"
                  : design.styleDefault !== null
                    ? "STYLE_DEFAULT"
                    : "NOT_CONFIGURED"
                : null;
              return (
                <tr key={id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                    {row.stage.name}
                    {!row.stage.isActive && <span className="ml-1 text-xs text-amber-600">(inactive)</span>}
                  </td>
                  {design && (
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {design.styleDefault === null ? "—" : `₹${design.styleDefault}`}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`${row.stage.name} cost`}
                        type="number"
                        min={0}
                        step="0.01"
                        disabled={!props.canEdit}
                        placeholder={design ? "Inherit" : "—"}
                        value={value}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [id]: e.target.value }))}
                        className={`${textInputClass()} w-28 py-1`}
                      />
                      {design && value !== "" && props.canEdit && (
                        <button
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, [id]: "" }))}
                          className="text-xs text-indigo-600 hover:text-indigo-500"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </td>
                  {design && (
                    <td className="px-3 py-2 text-xs">
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {effective === null || Number.isNaN(effective) ? "—" : `₹${effective}`}
                      </span>
                      {effectiveSource && <span className="ml-1 text-zinc-500">({SOURCE_LABEL[effectiveSource]})</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {invalid && <p className="text-xs text-red-600 dark:text-red-400">Costs must be numbers of 0 or more.</p>}
      {saveError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {saveError}
        </p>
      )}
      {props.canEdit ? (
        <div className="flex items-center justify-end gap-3">
          {savedAt && !isSaving && <span className="text-xs text-emerald-600">Saved.</span>}
          <button
            type="button"
            onClick={save}
            disabled={isSaving || !!invalid}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Stage Costs"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">You have view-only access to these costs.</p>
      )}
    </div>
  );
}

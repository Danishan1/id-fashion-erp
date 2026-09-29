"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MasterAnalysis, MasterField } from "@/core/ai-designer/tech-pack-master/schema";
import { AI_PAGE_NUMBERS, gradedValue, pageMode } from "@/core/ai-designer/tech-pack-master/schema";

/**
 * Master-prompt Tech Pack (2026-09-28): one click analyses the current
 * design with the company's master prompt, builds the 7 page prompts and
 * generates all 7 page images in the background. The user can correct any
 * analysis field (missing ones are highlighted), edit any page prompt,
 * regenerate single pages, and download the full 7-page PDF.
 */

type FactStatus = "CONFIRMED" | "ASSUMED" | "NOT_VISIBLE";

interface MasterPage {
  id: string;
  pageNumber: number;
  pageTitle: string;
  promptText: string | null;
  imageAttachmentId: string | null;
  imageStatus: "IN_PROGRESS" | "SUCCESS" | "FAILED" | null;
  imageError: string | null;
  promptEdited: boolean;
}

export interface MasterTechPack {
  id: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED";
  errorMessage: string | null;
  createdAt: string;
  garmentAnalysisJson: { format: "MASTER_V1"; analysis: MasterAnalysis } | null;
  pages: MasterPage[];
}

const STATUS_STYLE: Record<FactStatus, string> = {
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  ASSUMED: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  NOT_VISIBLE: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
};
const STATUS_LABEL: Record<FactStatus, string> = { CONFIRMED: "Confirmed", ASSUMED: "Assumed", NOT_VISIBLE: "Not visible" };

function imgUrl(id: string) {
  return `/api/v1/ai-designer/attachments/${id}/download?disposition=inline`;
}

async function readJson(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status}).`);
  return body;
}

const inputCls =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs focus:border-violet-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950";

function StatusPicker({ value, onChange }: { value: FactStatus; onChange: (s: FactStatus) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as FactStatus)} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[value]}`}>
      {(Object.keys(STATUS_LABEL) as FactStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function Section({ title, count, children, defaultOpen }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {count ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">{count} to confirm</span> : null}
          <span className="text-zinc-400 transition group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">{children}</div>
    </details>
  );
}

function FieldList({ fields, onChange }: { fields: MasterField[]; onChange: (next: MasterField[]) => void }) {
  return (
    <div className="space-y-1.5">
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-12 items-center gap-2">
          <input value={f.label} onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={`${inputCls} col-span-3 font-medium`} />
          <input
            value={f.value}
            onChange={(e) => onChange(fields.map((x, j) => (j === i ? { ...x, value: e.target.value, status: x.status === "NOT_VISIBLE" && e.target.value ? "CONFIRMED" : x.status } : x)))}
            placeholder="Enter value"
            className={`${inputCls} col-span-6 ${f.status === "NOT_VISIBLE" ? "border-rose-300 dark:border-rose-800" : ""}`}
          />
          <div className="col-span-2">
            <StatusPicker value={f.status as FactStatus} onChange={(s) => onChange(fields.map((x, j) => (j === i ? { ...x, status: s } : x)))} />
          </div>
          <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))} className="col-span-1 text-xs text-zinc-400 hover:text-rose-600" title="Remove">
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...fields, { label: "", value: "", status: "CONFIRMED" }])} className="text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
        + Add row
      </button>
    </div>
  );
}

function RowTable<T extends Record<string, unknown>>({
  rows,
  columns,
  blank,
  onChange,
}: {
  rows: T[];
  columns: { key: keyof T & string; label: string; type?: "number" | "status" | "calloutStatus"; width?: string }[];
  blank: T;
  onChange: (next: T[]) => void;
}) {
  const set = (i: number, key: keyof T, value: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
            {columns.map((c) => (
              <th key={c.key} className={`px-1 py-1 font-medium ${c.width ?? ""}`}>
                {c.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {columns.map((c) => (
                <td key={c.key} className="px-1 py-0.5">
                  {c.type === "status" ? (
                    <StatusPicker value={r[c.key] as FactStatus} onChange={(s) => set(i, c.key, s)} />
                  ) : c.type === "calloutStatus" ? (
                    <select value={String(r[c.key])} onChange={(e) => set(i, c.key, e.target.value)} className={inputCls}>
                      <option value="PROPOSED">Proposed</option>
                      <option value="CONFIRMED">Confirmed</option>
                    </select>
                  ) : c.type === "number" ? (
                    <input type="number" step="0.5" value={Number(r[c.key] ?? 0)} onChange={(e) => set(i, c.key, Number(e.target.value))} className={inputCls} />
                  ) : (
                    <input value={String(r[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)} className={inputCls} />
                  )}
                </td>
              ))}
              <td className="px-1 py-0.5">
                <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-rose-600" title="Remove">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...rows, { ...blank }])} className="mt-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
        + Add row
      </button>
    </div>
  );
}

/**
 * Pages 3/5/6 are never rendered as AI images (see pageMode) — but a
 * generic "trust us, it's in the PDF" card with no visible numbers looked
 * indistinguishable from "this failed to generate" (user-reported). This
 * shows the actual saved data right here, live, using the exact same
 * gradedValue() math the PDF itself uses, so the real content is visible
 * on screen without needing to download anything.
 */
function TypesetPreview({ pageNumber, analysis }: { pageNumber: number; analysis: MasterAnalysis | undefined }) {
  if (!analysis) return <span className="text-2xl">📋</span>;

  if (pageNumber === 3) {
    const rows = analysis.bom.slice(0, 6);
    return (
      <div className="w-full space-y-0.5 overflow-hidden text-[8px] leading-tight text-zinc-600 dark:text-zinc-400">
        {rows.map((b, i) => (
          <p key={i} className="truncate">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{b.item || `Row ${i + 1}`}</span>
            {b.composition ? ` — ${b.composition}` : ""}
          </p>
        ))}
        {analysis.bom.length > rows.length && <p className="text-zinc-400">+{analysis.bom.length - rows.length} more…</p>}
      </div>
    );
  }

  if (pageNumber === 5) {
    const rows = analysis.measurements.slice(0, 6);
    return (
      <div className="w-full space-y-0.5 overflow-hidden text-[8px] leading-tight text-zinc-600 dark:text-zinc-400">
        {rows.map((m, i) => (
          <p key={i} className="truncate">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{m.code || i + 1}.</span> {m.pom || "—"} — {m.baseValue} cm
          </p>
        ))}
        {analysis.measurements.length > rows.length && <p className="text-zinc-400">+{analysis.measurements.length - rows.length} more…</p>}
      </div>
    );
  }

  if (pageNumber === 6) {
    const rows = analysis.measurements.slice(0, 5);
    return (
      <table className="w-full text-left text-[7px] leading-tight text-zinc-600 dark:text-zinc-400">
        <thead>
          <tr>
            <th className="pr-1 font-medium">POM</th>
            {analysis.sizes.map((s) => (
              <th key={s} className={`px-0.5 text-center ${s === analysis.baseSize ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={i}>
              <td className="truncate pr-1 font-medium text-zinc-800 dark:text-zinc-200">{m.code || i + 1}</td>
              {analysis.sizes.map((s) => (
                <td key={s} className="px-0.5 text-center">
                  {gradedValue(analysis, m, s)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return null;
}

function countUnconfirmed(a: MasterAnalysis): Record<string, number> {
  const n = (xs: { status: string }[]) => xs.filter((x) => x.status === "NOT_VISIBLE").length;
  return {
    identification: n(a.identification),
    construction: n(a.construction),
    closure: n(a.closure),
    patternPrint: n(a.patternPrint),
    bom: n(a.bom),
    measurements: n(a.measurements),
    labelsPackaging: n(a.labelsPackaging),
  };
}

export function TechPackMasterPanel({ projectId, onChanged }: { projectId: string; onChanged?: (tp: MasterTechPack | null) => void }) {
  const [techPack, setTechPack] = useState<MasterTechPack | null | undefined>(undefined);
  const [draft, setDraft] = useState<MasterAnalysis | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MasterPage | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<number, string>>({});

  const apply = useCallback(
    (tp: MasterTechPack | null, resetDraft: boolean) => {
      setTechPack(tp);
      if (resetDraft) {
        setDraft(tp?.garmentAnalysisJson?.analysis ?? null);
        setDirty(false);
      }
      onChanged?.(tp);
    },
    [onChanged]
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const d = body?.data;
        const tp = d && (d.garmentAnalysisJson?.format === "MASTER_V1" || d.status !== "SUCCESS") ? (d as MasterTechPack) : null;
        setTechPack(tp);
        setDraft(tp?.garmentAnalysisJson?.analysis ?? null);
        onChanged?.(tp);
      })
      .catch(() => !cancelled && setTechPack(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, onChanged]);

  const generating = techPack?.pages.some((p) => p.imageStatus === "IN_PROGRESS") ?? false;

  // Poll while pages are rendering in the background. Only the page list is
  // refreshed — the user's unsaved analysis edits are never overwritten.
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => {
      fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack`)
        .then((r) => r.json())
        .then((body) => {
          if (body?.data?.id === techPack?.id) setTechPack((prev) => (prev ? { ...prev, pages: body.data.pages } : prev));
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [generating, projectId, techPack?.id]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const generate = () =>
    run("generate", async () => {
      const body = await readJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack`, { method: "POST" }));
      apply(body.data, true);
      setPromptDrafts({});
    });

  const regenerate = (pageNumbers: number[]) =>
    run(`regen-${pageNumbers.join(",")}`, async () => {
      if (!techPack) return;
      const body = await readJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/pages/regenerate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumbers }),
        })
      );
      apply(body.data, false);
    });

  const saveAnalysis = (thenRegenerate: boolean) =>
    run(thenRegenerate ? "save-regen" : "save", async () => {
      if (!techPack || !draft) return;
      const body = await readJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/analysis`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis: draft, rebuildPrompts: true }),
        })
      );
      apply(body.data, true);
      setPromptDrafts({});
      if (thenRegenerate) {
        const r = await readJson(
          await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/pages/regenerate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageNumbers: AI_PAGE_NUMBERS }),
          })
        );
        apply(r.data, false);
      }
    });

  const savePrompt = (pageNumber: number, reset: boolean) =>
    run(`prompt-${pageNumber}`, async () => {
      if (!techPack) return;
      const body = await readJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/pages/${pageNumber}/prompt`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reset ? { reset: true } : { promptText: promptDrafts[pageNumber] }),
        })
      );
      apply(body.data, false);
      setPromptDrafts((d) => {
        const next = { ...d };
        delete next[pageNumber];
        return next;
      });
    });

  const update = <K extends keyof MasterAnalysis>(key: K, value: MasterAnalysis[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  };

  const unconfirmed = useMemo(() => (draft ? countUnconfirmed(draft) : null), [draft]);
  const totalUnconfirmed = unconfirmed ? Object.values(unconfirmed).reduce((a, b) => a + b, 0) : 0;
  // Typeset pages are always ready — they are drawn from the data at PDF time.
  const doneCount = techPack?.pages.filter((p) => pageMode(p.pageNumber) === "TYPESET" || p.imageStatus === "SUCCESS").length ?? 0;

  if (techPack === undefined) return <p className="text-sm text-zinc-400">Loading tech pack…</p>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}

      {/* Header / actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 dark:border-violet-900 dark:from-violet-950/30 dark:to-fuchsia-950/20">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">7-Page AI Tech Pack</p>
          <p className="text-xs text-zinc-500">
            {!techPack
              ? "Analyses the current design with the master prompt, then generates all 7 tech pack pages as images."
              : techPack.status === "IN_PROGRESS"
                ? "Analysing the garment…"
                : techPack.status === "FAILED"
                  ? `Last attempt failed: ${techPack.errorMessage ?? "unknown error"}`
                  : generating
                    ? `Generating page images… ${doneCount} of 7 done`
                    : `${doneCount} of 7 pages generated.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {techPack?.status === "SUCCESS" && (
            <a
              href={`/api/v1/ai-designer/projects/${projectId}/tech-pack/download`}
              className={`rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-violet-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${doneCount === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              ⬇ Download PDF
            </a>
          )}
          <button
            type="button"
            onClick={generate}
            disabled={Boolean(busy) || techPack?.status === "IN_PROGRESS"}
            className="rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-1.5 text-xs font-semibold text-white shadow disabled:opacity-50"
          >
            {busy === "generate" ? "Analysing garment…" : techPack ? "↻ New Tech Pack" : "✨ Generate Tech Pack"}
          </button>
        </div>
      </div>

      {busy === "generate" && <p className="text-xs text-zinc-500">The master-prompt analysis takes about a minute; the 7 page images then render in the background (a few minutes).</p>}

      {techPack?.status === "SUCCESS" && (
        <>
          {/* Pages */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Pages</h3>
              <button type="button" onClick={() => regenerate(AI_PAGE_NUMBERS)} disabled={Boolean(busy) || generating} className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-50 dark:text-violet-300">
                ↻ Regenerate all pages
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {techPack.pages.map((p) =>
                pageMode(p.pageNumber) === "TYPESET" ? (
                  <div key={p.id} className="overflow-hidden rounded-lg border border-emerald-200 bg-white dark:border-emerald-900 dark:bg-zinc-900">
                    <div className="flex aspect-[2/3] w-full flex-col items-start justify-start gap-1 overflow-hidden bg-emerald-50/60 p-2 dark:bg-emerald-950/20">
                      <span className="mb-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">📋 Your real data:</span>
                      <TypesetPreview pageNumber={p.pageNumber} analysis={techPack.garmentAnalysisJson?.analysis} />
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[10px] font-semibold text-zinc-700 dark:text-zinc-200">
                        {p.pageNumber}. {p.pageTitle}
                      </p>
                      <p className="text-[10px] text-zinc-400">Typeset exactly like this in the PDF — updates when you save the analysis.</p>
                    </div>
                  </div>
                ) : (
                <div key={p.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <button type="button" onClick={() => p.imageAttachmentId && setPreview(p)} className="block aspect-[2/3] w-full bg-zinc-50 dark:bg-zinc-950">
                    {p.imageStatus === "IN_PROGRESS" ? (
                      <span className="flex h-full animate-pulse items-center justify-center text-[10px] text-violet-600">Generating…</span>
                    ) : p.imageAttachmentId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imgUrl(p.imageAttachmentId)} alt={p.pageTitle} className="h-full w-full object-contain" />
                    ) : (
                      <span className="flex h-full items-center justify-center p-2 text-center text-[10px] text-rose-600" title={p.imageError ?? ""}>
                        {p.imageStatus === "FAILED" ? `Failed: ${(p.imageError ?? "").slice(0, 80)}` : "Not generated"}
                      </span>
                    )}
                  </button>
                  <div className="p-1.5">
                    <p className="truncate text-[10px] font-semibold text-zinc-700 dark:text-zinc-200">
                      {p.pageNumber}. {p.pageTitle}
                    </p>
                    <button type="button" onClick={() => regenerate([p.pageNumber])} disabled={Boolean(busy) || p.imageStatus === "IN_PROGRESS"} className="text-[10px] font-medium text-violet-700 hover:underline disabled:opacity-40 dark:text-violet-300">
                      ↻ Regenerate
                    </button>
                  </div>
                </div>
                )
              )}
            </div>
          </div>

          {/* Analysis editor */}
          {draft && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  Garment Analysis {totalUnconfirmed > 0 && <span className="ml-1 text-xs font-normal text-rose-600">· {totalUnconfirmed} fields not visible — please fill in</span>}
                </h3>
                <div className="flex gap-2">
                  <button type="button" onClick={() => saveAnalysis(false)} disabled={!dirty || Boolean(busy)} className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-semibold disabled:opacity-40 dark:border-zinc-700">
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" onClick={() => saveAnalysis(true)} disabled={!dirty || Boolean(busy) || generating} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40">
                    {busy === "save-regen" ? "Saving…" : "Save & regenerate pages"}
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500">Saving rebuilds every page prompt you have not edited by hand, so corrected values appear on the next page images.</p>

              <Section title="A. Garment Identification" count={unconfirmed?.identification} defaultOpen>
                <FieldList fields={draft.identification} onChange={(v) => update("identification", v)} />
              </Section>
              <Section title="B. Construction & Silhouette" count={unconfirmed?.construction}>
                <FieldList fields={draft.construction} onChange={(v) => update("construction", v)} />
              </Section>
              <Section title="C. Closure System" count={unconfirmed?.closure}>
                <FieldList fields={draft.closure} onChange={(v) => update("closure", v)} />
              </Section>
              <Section title="D. Panels & Seam Construction (callouts)">
                <RowTable
                  rows={draft.seamCallouts}
                  blank={{ number: draft.seamCallouts.length + 1, location: "", specification: "", status: "PROPOSED" as const }}
                  columns={[
                    { key: "number", label: "#", type: "number", width: "w-14" },
                    { key: "location", label: "Location" },
                    { key: "specification", label: "Technical specification" },
                    { key: "status", label: "Status", type: "calloutStatus", width: "w-28" },
                  ]}
                  onChange={(v) => update("seamCallouts", v)}
                />
              </Section>
              <Section title="E. Colors & Colorways">
                <p className="mb-1 text-[11px] font-medium text-zinc-500">Colors</p>
                <RowTable
                  rows={draft.colors}
                  blank={{ name: "", pantone: "", hex: "", panel: "" }}
                  columns={[
                    { key: "name", label: "Color" },
                    { key: "pantone", label: "Pantone" },
                    { key: "hex", label: "HEX" },
                    { key: "panel", label: "Panel" },
                  ]}
                  onChange={(v) => update("colors", v)}
                />
                <p className="mb-1 mt-3 text-[11px] font-medium text-zinc-500">Colorways</p>
                <RowTable
                  rows={draft.colorways}
                  blank={{ code: "", name: "", main: "", contrast: "", trim: "", artwork: "", notes: "" }}
                  columns={[
                    { key: "code", label: "Code" },
                    { key: "name", label: "Name" },
                    { key: "main", label: "Main" },
                    { key: "contrast", label: "Contrast" },
                    { key: "trim", label: "Trim" },
                    { key: "artwork", label: "Artwork" },
                    { key: "notes", label: "Notes" },
                  ]}
                  onChange={(v) => update("colorways", v)}
                />
              </Section>
              <Section title="F. Artwork & Graphics">
                <RowTable
                  rows={draft.artwork}
                  blank={{ type: "", placement: "", scale: "", dimensions: "", method: "", fromHps: "", fromCf: "", alignment: "" }}
                  columns={[
                    { key: "type", label: "Type" },
                    { key: "placement", label: "Placement" },
                    { key: "scale", label: "Scale" },
                    { key: "dimensions", label: "Dimensions" },
                    { key: "method", label: "Method" },
                    { key: "fromHps", label: "From HPS" },
                    { key: "fromCf", label: "From CF" },
                    { key: "alignment", label: "Alignment" },
                  ]}
                  onChange={(v) => update("artwork", v)}
                />
              </Section>
              <Section title="G. Pattern / Print" count={unconfirmed?.patternPrint}>
                <FieldList fields={draft.patternPrint} onChange={(v) => update("patternPrint", v)} />
              </Section>
              <Section title="H. Bill of Materials" count={unconfirmed?.bom}>
                <RowTable
                  rows={draft.bom}
                  blank={{ item: "", description: "", composition: "", gsm: "", color: "", consumption: "", supplier: "TBD", notes: "", status: "CONFIRMED" as const }}
                  columns={[
                    { key: "item", label: "Item" },
                    { key: "description", label: "Description" },
                    { key: "composition", label: "Composition" },
                    { key: "gsm", label: "GSM" },
                    { key: "color", label: "Color" },
                    { key: "consumption", label: "Consumption" },
                    { key: "supplier", label: "Supplier" },
                    { key: "notes", label: "Notes" },
                    { key: "status", label: "Status", type: "status" },
                  ]}
                  onChange={(v) => update("bom", v)}
                />
              </Section>
              <Section title="I. Measurements & Grading" count={unconfirmed?.measurements}>
                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    Sizes
                    <input
                      value={draft.sizes.join(", ")}
                      onChange={(e) =>
                        update(
                          "sizes",
                          e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean)
                        )
                      }
                      className={`${inputCls} w-56`}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Base size
                    <select value={draft.baseSize} onChange={(e) => update("baseSize", e.target.value)} className={`${inputCls} w-20`}>
                      {draft.sizes.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <RowTable
                  rows={draft.measurements}
                  blank={{ code: "", pom: "", howToMeasure: "", tolerance: "± 1.0", baseValue: 0, gradeRule: 0, status: "CONFIRMED" as const }}
                  columns={[
                    { key: "code", label: "Code", width: "w-14" },
                    { key: "pom", label: "Point of measure" },
                    { key: "howToMeasure", label: "How to measure" },
                    { key: "tolerance", label: "Tol.", width: "w-20" },
                    { key: "baseValue", label: `${draft.baseSize} (cm)`, type: "number", width: "w-20" },
                    { key: "gradeRule", label: "Grade/size", type: "number", width: "w-20" },
                    { key: "status", label: "Status", type: "status" },
                  ]}
                  onChange={(v) => update("measurements", v)}
                />
                <div className="mt-3 overflow-x-auto">
                  <p className="mb-1 text-[11px] font-medium text-zinc-500">Graded spec (calculated)</p>
                  <table className="text-[11px]">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left">POM</th>
                        {draft.sizes.map((s) => (
                          <th key={s} className={`px-2 py-1 ${s === draft.baseSize ? "text-violet-700 dark:text-violet-300" : ""}`}>
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.measurements.map((m, i) => (
                        <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-2 py-0.5">
                            {m.code} {m.pom}
                          </td>
                          {draft.sizes.map((s) => (
                            <td key={s} className="px-2 py-0.5 text-center">
                              {gradedValue(draft, m, s)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <Section title="J. Labels & Packaging" count={unconfirmed?.labelsPackaging}>
                <FieldList fields={draft.labelsPackaging} onChange={(v) => update("labelsPackaging", v)} />
              </Section>
              <Section title="Garment description (used in every page prompt)">
                <textarea value={draft.garmentVisualDescription} onChange={(e) => update("garmentVisualDescription", e.target.value)} rows={4} className={inputCls} />
              </Section>
              <Section title="Notes for Designer & Suggested Additional Views">
                <p className="mb-1 text-[11px] font-medium text-zinc-500">Notes for designer (one per line)</p>
                <textarea value={draft.notesForDesigner.join("\n")} onChange={(e) => update("notesForDesigner", e.target.value.split("\n"))} rows={5} className={inputCls} />
                <p className="mb-1 mt-2 text-[11px] font-medium text-zinc-500">Suggested additional views (one per line)</p>
                <textarea value={draft.suggestedAdditionalViews.join("\n")} onChange={(e) => update("suggestedAdditionalViews", e.target.value.split("\n"))} rows={3} className={inputCls} />
              </Section>
            </div>
          )}

          {/* Page prompts */}
          <Section title="Page Prompts (advanced — edit the exact prompt sent for each page)">
            <div className="space-y-3">
              {techPack.pages.filter((p) => pageMode(p.pageNumber) === "AI").map((p) => {
                const value = promptDrafts[p.pageNumber] ?? p.promptText ?? "";
                const changed = promptDrafts[p.pageNumber] !== undefined && promptDrafts[p.pageNumber] !== p.promptText;
                return (
                  <div key={p.id}>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                        Page {p.pageNumber} — {p.pageTitle} {p.promptEdited && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700">edited</span>}
                      </p>
                      <div className="flex gap-3 text-[11px]">
                        {p.promptEdited && (
                          <button type="button" onClick={() => savePrompt(p.pageNumber, true)} disabled={Boolean(busy)} className="text-zinc-500 hover:underline">
                            Reset to auto
                          </button>
                        )}
                        <button type="button" onClick={() => savePrompt(p.pageNumber, false)} disabled={!changed || Boolean(busy)} className="font-medium text-violet-700 hover:underline disabled:opacity-40 dark:text-violet-300">
                          Save prompt
                        </button>
                      </div>
                    </div>
                    <textarea value={value} onChange={(e) => setPromptDrafts((d) => ({ ...d, [p.pageNumber]: e.target.value }))} rows={6} className={`${inputCls} font-mono`} />
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

      {preview?.imageAttachmentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)} role="presentation">
          <div className="max-h-full max-w-3xl overflow-auto rounded-lg bg-white" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
              <span>
                Page {preview.pageNumber} — {preview.pageTitle}
              </span>
              <button type="button" onClick={() => setPreview(null)} className="text-zinc-500">
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl(preview.imageAttachmentId)} alt={preview.pageTitle} className="w-full" />
          </div>
        </div>
      )}
    </div>
  );
}

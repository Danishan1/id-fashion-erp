"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { getGarmentTemplate } from "@/core/ai-designer/catalogs/garment-template-catalog";
import { attachmentUrl } from "../../../new-design/NewDesignWorkspace";
import { TechPackMasterPanel } from "../../../_shared/TechPackMasterPanel";

interface VersionRow {
  id: string;
  versionNumber: number;
  changeSummary: string | null;
  approvalStatus: string;
  currentImage: { id: string; imageAttachmentId: string } | null;
}

export interface DesignViewProject {
  id: string;
  projectNumber: string;
  projectName: string;
  designSource: string | null;
  sketchImageAttachmentId?: string | null;
  sourceImageAttachmentId?: string | null;
  fabricName: string | null;
  fabricComposition: string | null;
  fabricImageAttachmentId: string | null;
  fabricProduct: { styleName: string; styleCode: string } | null;
  productCategory: string | null;
  targetCustomer: string | null;
  ageGroup: string | null;
  garmentTemplateKey: string | null;
  brandName: string | null;
  environmentLabel: string | null;
  currentVersion: VersionRow | null;
  versions: VersionRow[];
}

interface ColorVariant {
  id: string;
  imageAttachmentId: string;
  colorName: string | null;
}

interface ColorOption {
  id: string;
  name: string;
  hexValue: string | null;
}

const QUICK_COLORS = ["Ivory", "Black", "Navy Blue", "Emerald Green", "Maroon", "Blush Pink", "Mustard Yellow", "Lavender"];

export function DesignViewClient({ project }: { project: DesignViewProject }) {
  const [heroId, setHeroId] = useState<string | null>(project.currentVersion?.currentImage?.imageAttachmentId ?? null);
  const [viewMode, setViewMode] = useState<"GARMENT" | "SKETCH">("GARMENT");
  const [sketchId, setSketchId] = useState<string | null>(
    project.sketchImageAttachmentId ||
    (project.designSource === "SKETCH" ? project.sourceImageAttachmentId : null) ||
    null
  );
  const [sketchBusy, setSketchBusy] = useState(false);
  const [variants, setVariants] = useState<ColorVariant[]>([]);
  const [colorOptions, setColorOptions] = useState<ColorOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function generateSketch() {
    setSketchBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/ai-designer/projects/${project.id}/generate-sketch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewAngle: "BOTH" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "CAD sketch generation failed.");
      if (body.data?.sketchAttachmentId) {
        setSketchId(body.data.sketchAttachmentId);
        setViewMode("SKETCH");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate CAD flat sketch.");
    } finally {
      setSketchBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/ai-designer/projects/${project.id}/new-design/color-variants`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setVariants(body.data);
      })
      .catch(() => undefined);
    fetch("/api/v1/colors")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setColorOptions((body.data as ColorOption[]).slice(0, 40));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const colorNames = [...new Set([...colorOptions.map((c) => c.name), ...QUICK_COLORS])];
  const hexFor = (name: string) => colorOptions.find((c) => c.name === name)?.hexValue ?? null;

  function toggle(name: string) {
    setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length >= 6 ? prev : [...prev, name]));
  }

  async function generateVariants() {
    const colors = [...picked, ...(customColor.trim() ? [customColor.trim()] : [])];
    if (colors.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/ai-designer/projects/${project.id}/new-design/color-variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Colour variant generation failed.");
      setVariants(body.data.variants);
      const failed = (body.data.results as { colorName: string; ok: boolean }[]).filter((r) => !r.ok);
      if (failed.length) setNotice(`Could not create: ${failed.map((f) => f.colorName).join(", ")}.`);
      setPicked([]);
      setCustomColor("");
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Colour variant generation failed.");
    } finally {
      setBusy(false);
    }
  }

  const template = project.garmentTemplateKey ? getGarmentTemplate(project.garmentTemplateKey) : undefined;
  const details: [string, string | null][] = [
    ["Garment", project.productCategory],
    ["Customer", [template?.customerLabel ?? project.targetCustomer, project.ageGroup].filter(Boolean).join(" · ") || null],
    ["Fabric", project.fabricProduct ? `${project.fabricProduct.styleName} (${project.fabricProduct.styleCode})` : project.fabricName],
    ["Composition", project.fabricComposition],
    ["Brand", project.brandName],
    ["Setting", project.environmentLabel],
    ["Version", project.currentVersion ? `v${project.currentVersion.versionNumber}` : null],
  ];

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Catalogue Designs", href: "/ai-designer/catalogue-designs" },
          { label: project.projectNumber },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-violet-600 dark:text-violet-400">{project.projectNumber}</p>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{project.projectName}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={!project.currentVersion}
            className="rounded-xl border-2 border-violet-500 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
          >
            🎨 See all colour variants
          </button>
          <button
            type="button"
            onClick={generateSketch}
            disabled={sketchBusy}
            className="rounded-xl border-2 border-violet-500 px-4 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950/40"
          >
            {sketchBusy ? "✨ Generating CAD Sketch…" : "✏️ Generate CAD Flat Sketch"}
          </button>
          <a
            href="#tech-pack"
            className="rounded-xl border-2 border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-violet-400 dark:border-zinc-700 dark:text-zinc-200"
          >
            📄 Tech Pack
          </a>
          <Link
            href={`/ai-designer/catalogue-designs/${project.id}/edit?from=garment`}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:brightness-110"
          >
            👗 Edit from Garment
          </Link>
          <Link
            href={`/ai-designer/catalogue-designs/${project.id}/edit?from=sketch`}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:brightness-110"
          >
            ✏️ Edit from Sketch
          </Link>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}
      {notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{notice}</div>}

      {pickerOpen && (
        <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-5 dark:border-violet-900 dark:from-violet-950/30 dark:to-fuchsia-950/20">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Choose colours (up to 6)</h2>
          <p className="mt-0.5 text-xs text-zinc-500">AI recolours this exact design — same model, design and print, new colourway.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {colorNames.map((name) => {
              const on = picked.includes(name);
              const hex = hexFor(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    on ? "border-violet-600 bg-violet-600 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {hex && <span className="h-3 w-3 rounded-full border border-white/60" style={{ backgroundColor: hex }} />}
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              placeholder="Or type a colour, e.g. Dusty Rose"
              className="w-64 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="button"
              disabled={busy || (picked.length === 0 && !customColor.trim())}
              onClick={generateVariants}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Creating variants…" : `Create ${picked.length + (customColor.trim() ? 1 : 0)} variant(s)`}
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          {/* View toggle: Garment vs Sketch */}
          <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-1.5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setViewMode("GARMENT")}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  viewMode === "GARMENT"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
                }`}
              >
                👗 Garment Photo
              </button>
              <button
                type="button"
                onClick={() => setViewMode("SKETCH")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                  viewMode === "SKETCH"
                    ? "bg-violet-600 text-white shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
                }`}
              >
                <span>✏️ Technical Flat Sketch</span>
                {sketchId && <span className="text-xs">✓</span>}
              </button>
            </div>
            {viewMode === "SKETCH" && !sketchId && (
              <button
                type="button"
                onClick={generateSketch}
                disabled={sketchBusy}
                className="text-xs font-semibold text-violet-600 hover:underline disabled:opacity-50 dark:text-violet-400"
              >
                {sketchBusy ? "Generating…" : "✨ Generate CAD Sketch"}
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            {viewMode === "SKETCH" ? (
              sketchId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachmentUrl(sketchId)} alt="Technical CAD Flat Sketch" className="mx-auto max-h-[720px] w-full object-contain p-4" />
              ) : (
                <div className="flex flex-col items-center justify-center p-16 text-center">
                  <span className="text-4xl">📐</span>
                  <h3 className="mt-3 text-sm font-bold text-zinc-900 dark:text-zinc-100">No Technical Flat Sketch Yet</h3>
                  <p className="mt-1 max-w-sm text-xs text-zinc-500">
                    Generate a clean 2D CAD flat sketch with seamlines, topstitching, and construction darts directly from this design.
                  </p>
                  <button
                    type="button"
                    disabled={sketchBusy}
                    onClick={generateSketch}
                    className="mt-4 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-4 py-2 text-xs font-semibold text-white shadow hover:brightness-110 disabled:opacity-50"
                  >
                    {sketchBusy ? "✨ Generating CAD Sketch…" : "✨ Generate CAD Flat Sketch"}
                  </button>
                </div>
              )
            ) : heroId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentUrl(heroId)} alt={project.projectName} className="mx-auto max-h-[720px] w-full object-contain" />
            ) : (
              <div className="flex h-96 items-center justify-center text-sm text-zinc-400">No design generated yet.</div>
            )}
          </div>
          {project.versions.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {project.versions
                .filter((v) => v.currentImage)
                .map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setHeroId(v.currentImage!.imageAttachmentId)}
                    className={`relative shrink-0 overflow-hidden rounded-xl border-2 ${
                      heroId === v.currentImage!.imageAttachmentId ? "border-violet-500" : "border-transparent"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachmentUrl(v.currentImage!.imageAttachmentId)} alt={`v${v.versionNumber}`} className="h-24 w-20 object-cover object-top" />
                    <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-xs text-white">v{v.versionNumber}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Design Details</h2>
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {details
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="grid grid-cols-3 gap-2 py-2 text-sm">
                    <dt className="text-xs font-medium text-zinc-500">{k}</dt>
                    <dd className="col-span-2 text-zinc-800 dark:text-zinc-100">{v}</dd>
                  </div>
                ))}
            </dl>
            {project.fabricImageAttachmentId && (
              <div className="mt-4 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentUrl(project.fabricImageAttachmentId)} alt="Fabric" className="h-14 w-14 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700" />
                <span className="text-xs text-zinc-500">Fabric used</span>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Download</h2>
            <div className="flex gap-2">
              {(["png", "jpg", "pdf"] as const).map((fmt) => (
                <a
                  key={fmt}
                  href={`/api/v1/ai-designer/projects/${project.id}/export?format=${fmt}`}
                  className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-center text-xs font-semibold uppercase text-zinc-700 hover:border-violet-300 hover:text-violet-700 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {fmt}
                </a>
              ))}
            </div>
            {project.designSource && (
              <Link href={`/ai-designer/new-design/${project.id}`} className="mt-3 block text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
                ← Back to the design steps
              </Link>
            )}
          </section>
        </div>
      </div>

      {project.currentVersion && (
        <section id="tech-pack" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tech Pack</h2>
          <TechPackMasterPanel projectId={project.id} />
        </section>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Colour Variants</h2>
          <span className="text-xs text-zinc-500">{variants.length} variant{variants.length === 1 ? "" : "s"}</span>
        </div>
        {variants.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-400">No colour variants yet — use “See all colour variants” to create some.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setHeroId(v.imageAttachmentId)}
                className={`overflow-hidden rounded-xl border-2 text-left transition hover:shadow-md ${
                  heroId === v.imageAttachmentId ? "border-violet-500" : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentUrl(v.imageAttachmentId)} alt={v.colorName ?? "Variant"} className="h-56 w-full object-cover object-top" />
                <p className="flex items-center gap-1.5 p-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                  {v.colorName && hexFor(v.colorName) && (
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: hexFor(v.colorName)! }} />
                  )}
                  {v.colorName ?? "Variant"}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

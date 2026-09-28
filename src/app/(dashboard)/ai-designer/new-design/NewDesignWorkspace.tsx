"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { FABRIC_FIELD_KEYS, type FabricFieldKey } from "@/modules/ai-designer/ai-designer.schema";
import {
  GARMENT_ANALYSIS_FIELD_KEYS,
  GARMENT_ANALYSIS_FIELD_LABELS,
  type GarmentAnalysisFieldKey,
} from "@/core/ai-designer/garment-analysis/schema";
import { GARMENT_TEMPLATES, getGarmentTemplate, type GarmentSuggestion } from "@/core/ai-designer/catalogs/garment-template-catalog";
import { TARGET_CUSTOMER_LABELS, TARGET_CUSTOMER_VALUES, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { ENVIRONMENTS } from "@/core/ai-designer/catalogs/environment-catalog";

type DesignSource = "FABRIC" | "GARMENT" | "SKETCH";
type NewDesignStep = "SOURCE" | "GARMENT" | "GENERATE" | "DESIGNS";

export interface NewDesignProject {
  id: string;
  projectNumber: string;
  projectName: string;
  designSource: DesignSource | null;
  newDesignStep: NewDesignStep | null;
  fabricImageAttachmentId: string | null;
  fabricProductId: string | null;
  fabricProduct: { id: string; styleName: string; styleCode: string } | null;
  sourceImageAttachmentId: string | null;
  sourceAnalysisJson: Record<string, string> | null;
  garmentSuggestionsJson: GarmentSuggestion[] | null;
  garmentTemplateKey: string | null;
  customTemplateAttachmentId: string | null;
  targetCustomer: TargetCustomer | null;
  productCategory: string | null;
  environmentKey: string | null;
  environmentLabel: string | null;
  isCustomEnvironment: boolean;
  brandName: string | null;
  brandLogoAttachmentId: string | null;
  currentVersionId: string | null;
  [key: string]: unknown;
}

interface ImageRow {
  id: string;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  createdAt: string;
}

interface FabricSuggestion {
  id: string;
  styleName: string;
  styleCode: string;
  description: string | null;
  mainImageUrl: string | null;
  score: number;
}

const STEPS: { key: NewDesignStep; label: string; hint: string }[] = [
  { key: "SOURCE", label: "Upload & Analyse", hint: "Fabric, garment or sketch" },
  { key: "GARMENT", label: "Garment Type", hint: "Pick the model template" },
  { key: "GENERATE", label: "Brand & Generate", hint: "Logo, setting, AI render" },
  { key: "DESIGNS", label: "Your Designs", hint: "View & edit" },
];

const SOURCE_TABS: { key: DesignSource; label: string; description: string; icon: string }[] = [
  { key: "FABRIC", label: "Through Fabric", description: "Start from a fabric swatch photo", icon: "🧵" },
  { key: "GARMENT", label: "Through Garments", description: "Start from a garment photo", icon: "👗" },
  { key: "SKETCH", label: "Through Sketch", description: "Start from a fashion sketch", icon: "✏️" },
];

const FABRIC_FIELD_LABELS: Record<FabricFieldKey, string> = {
  fabricName: "Fabric Name",
  fabricComposition: "Composition",
  fabricGsm: "GSM",
  fabricWidth: "Width",
  fabricWeave: "Weave",
  fabricStretch: "Stretch",
  fabricOpacity: "Opacity",
  fabricTexture: "Texture",
  fabricPatternType: "Pattern Type",
  fabricPrintType: "Print Type",
  fabricSuitableSeason: "Suitable Season",
  fabricRecommendedGarments: "Recommended Garments",
  fabricColor: "Colour",
};

export function attachmentUrl(id: string) {
  return `/api/v1/ai-designer/attachments/${id}/download?disposition=inline`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? `Request failed (${res.status}).`;
  } catch {
    return `Request failed (${res.status}).`;
  }
}

function Card({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 px-5 py-3 dark:border-zinc-800 dark:from-indigo-950/40 dark:via-violet-950/30 dark:to-fuchsia-950/30">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function DropZone({
  label,
  hint,
  imageUrl,
  busy,
  onFile,
  compact,
}: {
  label: string;
  hint: string;
  imageUrl: string | null;
  busy?: boolean;
  onFile: (file: File) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition ${
        compact ? "min-h-[160px]" : "min-h-[340px]"
      } ${
        dragging
          ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30"
          : "border-zinc-300 bg-zinc-50 hover:border-violet-400 hover:bg-violet-50/50 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-500"
      }`}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt={label} className={`${compact ? "max-h-[160px]" : "max-h-[420px]"} w-full object-contain`} />
      ) : (
        <div className="px-6 py-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-2xl text-white shadow-md">
            ⬆
          </div>
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{label}</p>
          <p className="mt-1 text-xs text-zinc-500">{hint}</p>
          <p className="mt-2 text-[11px] text-zinc-400">JPG, PNG or WEBP · drag & drop or click</p>
        </div>
      )}
      {imageUrl && (
        <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
          Replace image
        </span>
      )}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70">
          <span className="animate-pulse text-sm font-medium text-violet-700 dark:text-violet-300">Working…</span>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function TemplateThumb({ templateKey, className }: { templateKey: string; className?: string }) {
  const t = getGarmentTemplate(templateKey);
  if (t?.templateUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={t.templateUrl} alt={t.label} className={`object-cover object-top ${className ?? ""}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-3xl dark:from-zinc-800 dark:to-zinc-700 ${className ?? ""}`}>
      👚
    </div>
  );
}

function PrimaryButton({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:shadow-lg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function NewDesignWorkspace({ initialProject }: { initialProject: NewDesignProject | null }) {
  const router = useRouter();
  const [project, setProject] = useState<NewDesignProject | null>(initialProject);
  const [activeTab, setActiveTab] = useState<DesignSource>(initialProject?.designSource ?? "FABRIC");
  const [step, setStep] = useState<NewDesignStep>(initialProject?.newDesignStep ?? "SOURCE");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fabricSuggestions, setFabricSuggestions] = useState<FabricSuggestion[] | null>(null);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [imageCount, setImageCount] = useState<1 | 3 | 4>(3);
  const [brandDraft, setBrandDraft] = useState(initialProject?.brandName ?? "");
  const [customerFilter, setCustomerFilter] = useState<TargetCustomer>(initialProject?.targetCustomer ?? "WOMEN");

  const projectId = project?.id ?? null;
  const source = project?.designSource ?? activeTab;

  const reload = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/ai-designer/projects/${id}`);
    if (res.ok) {
      const body = await res.json();
      setProject(body.data);
      return body.data as NewDesignProject;
    }
    return null;
  }, []);

  const loadImages = useCallback(async (id: string) => {
    const res = await fetch(`/api/v1/ai-designer/projects/${id}/new-design/designs`);
    if (res.ok) {
      const body = await res.json();
      setImages((body.data as ImageRow[]).filter((img) => img.decision !== "REJECTED"));
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/v1/ai-designer/projects/${projectId}/new-design/designs`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setImages((body.data as ImageRow[]).filter((img) => img.decision !== "REJECTED"));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || source === "FABRIC" || !project?.sourceAnalysisJson) return;
    let cancelled = false;
    fetch(`/api/v1/ai-designer/projects/${projectId}/new-design/fabric-suggestions`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setFabricSuggestions(body.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, source, project?.sourceAnalysisJson]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }

  async function goTo(next: NewDesignStep) {
    setStep(next);
    if (projectId) {
      await fetch(`/api/v1/ai-designer/projects/${projectId}/new-design/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: next }),
      }).catch(() => undefined);
    }
  }

  async function handleSourceFile(file: File) {
    await run("upload", async () => {
      let id = projectId;
      if (!id) {
        const created = await post("/api/v1/ai-designer/new-design", { designSource: activeTab });
        id = created.data.id as string;
      }
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/ai-designer/projects/${id}/new-design/source-image`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readError(res));
      await reload(id);
      // Update the URL without a navigation: router.replace() would remount this
      // workspace from the server's pre-analysis snapshot, and the analysis
      // result below would land in the unmounted instance (the panel stayed
      // empty even though the API returned data).
      if (!projectId) window.history.replaceState(null, "", `/ai-designer/new-design/${id}`);
      // Analyse straight away — the right panel fills in as soon as it's done.
      setBusy("analyze");
      await post(`/api/v1/ai-designer/projects/${id}/new-design/analyze`);
      await reload(id);
    });
  }

  async function reanalyze() {
    if (!projectId) return;
    await run("analyze", async () => {
      await post(`/api/v1/ai-designer/projects/${projectId}/new-design/analyze`);
      await reload(projectId);
    });
  }

  async function saveAnalysisField(field: string, value: string) {
    if (!projectId) return;
    const isFabric = source === "FABRIC";
    const url = isFabric
      ? `/api/v1/ai-designer/projects/${projectId}/fabric-analysis`
      : `/api/v1/ai-designer/projects/${projectId}/new-design/analysis-field`;
    const res = await fetch(url, {
      method: isFabric ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value }),
    });
    if (res.ok) await reload(projectId);
    else setError(await readError(res));
  }

  async function selectTemplate(key: string) {
    if (!projectId) return;
    await run("template", async () => {
      await post(`/api/v1/ai-designer/projects/${projectId}/new-design/garment-template`, { key });
      await reload(projectId);
    });
  }

  async function selectFabric(productId: string) {
    if (!projectId) return;
    await run("fabric", async () => {
      await post(`/api/v1/ai-designer/projects/${projectId}/new-design/select-fabric`, { productId });
      await reload(projectId);
    });
  }

  async function uploadFile(url: string, file: File, label: string) {
    if (!projectId) return;
    await run(label, async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) throw new Error(await readError(res));
      await reload(projectId);
    });
  }

  async function saveEnvironment(key: string) {
    if (!projectId) return;
    const env = ENVIRONMENTS.find((e) => e.key === key);
    await run("env", async () => {
      const res = await fetch(`/api/v1/ai-designer/projects/${projectId}/wizard-selections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentKey: key, environmentLabel: env?.label, isCustomEnvironment: false }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await reload(projectId);
    });
  }

  async function saveBrandName() {
    if (!projectId || (project?.brandName ?? "") === brandDraft) return;
    await fetch(`/api/v1/ai-designer/projects/${projectId}/branding`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandName: brandDraft }),
    });
    await reload(projectId);
  }

  async function generate() {
    if (!projectId) return;
    await saveBrandName();
    setNotice(null);
    await run("generate", async () => {
      const body = await post(`/api/v1/ai-designer/projects/${projectId}/new-design/generate`, { imageCount });
      if (body?.data?.usedTemplate === false && ((project?.garmentTemplateKey && getGarmentTemplate(project.garmentTemplateKey)?.templateUrl) || project?.customTemplateAttachmentId)) {
        setNotice(
          'Generated without the catalogue model photo: no AI provider has "Design Replication" or "Multi-Fabric" enabled. ' +
            "Turn one on in Administration → AI Configuration to keep the same model in every design."
        );
      }
      await reload(projectId);
      await loadImages(projectId);
      setStep("DESIGNS");
    });
  }

  async function openDesign(imageId: string, target: "view" | "edit") {
    if (!projectId) return;
    await run("open", async () => {
      await post(`/api/v1/ai-designer/projects/${projectId}/new-design/make-current`, { imageId });
      router.push(`/ai-designer/catalogue-designs/${projectId}/${target}`);
    });
  }

  async function decide(imageId: string, decision: "SELECT" | "REJECT") {
    if (!projectId) return;
    await run("decide", async () => {
      await post(`/api/v1/ai-designer/projects/${projectId}/images/${imageId}/decide`, { decision, confirmed: true });
      await loadImages(projectId);
      await reload(projectId);
    });
  }

  const sourceImageId = source === "FABRIC" ? project?.fabricImageAttachmentId : project?.sourceImageAttachmentId;
  const hasAnalysis = source === "FABRIC" ? Boolean(project?.fabricName) : Boolean(project?.sourceAnalysisJson);
  const suggestions = project?.garmentSuggestionsJson ?? [];
  const selectedTemplate = project?.garmentTemplateKey ? getGarmentTemplate(project.garmentTemplateKey) : undefined;
  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const canLeaveSource = Boolean(hasAnalysis && project?.fabricImageAttachmentId && project?.garmentTemplateKey);

  const templatesForCustomer = useMemo(() => GARMENT_TEMPLATES.filter((t) => t.customer === customerFilter), [customerFilter]);

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "AI Designer", href: "/ai-designer/catalogue-designs" },
          { label: project ? project.projectNumber : "New Design" },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-2xl font-bold text-transparent">
            New Design
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Upload a fabric, garment or sketch — AI analyses it, dresses our catalogue model, and builds premium designs.
          </p>
        </div>
        <Link href="/ai-designer/catalogue-designs" className="text-sm font-medium text-violet-700 hover:underline dark:text-violet-300">
          View all catalogue designs →
        </Link>
      </div>

      {/* Stepper */}
      <ol className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          const reachable = Boolean(projectId) && (i <= stepIndex || (i === 1 && canLeaveSource) || (i === 3 && images.length > 0));
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => goTo(s.key)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ${
                  current
                    ? "border-violet-500 bg-violet-50 shadow-sm dark:bg-violet-950/40"
                    : done
                      ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
                      : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    current
                      ? "bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white"
                      : done
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.label}</span>
                  <span className="block text-[11px] text-zinc-500">{s.hint}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {notice}
        </div>
      )}

      {/* ---------------------------------------------------------------- Step 1 */}
      {step === "SOURCE" && (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            {SOURCE_TABS.map((tab) => {
              const locked = Boolean(project?.designSource) && project?.designSource !== tab.key;
              const active = source === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  disabled={locked}
                  title={locked ? "Start a new design to use a different source." : undefined}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition ${
                    active
                      ? "border-violet-500 bg-gradient-to-br from-violet-50 to-fuchsia-50 shadow-md dark:from-violet-950/40 dark:to-fuchsia-950/30"
                      : "border-zinc-200 bg-white hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  <span className="text-2xl">{tab.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{tab.label}</span>
                    <span className="block text-xs text-zinc-500">{tab.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card
                title={source === "FABRIC" ? "Fabric Image" : source === "GARMENT" ? "Garment Image" : "Sketch Image"}
                subtitle="Upload — analysis starts automatically."
              >
                <DropZone
                  label={`Upload ${source === "FABRIC" ? "a fabric swatch" : source === "GARMENT" ? "a garment photo" : "a sketch"}`}
                  hint={
                    source === "FABRIC"
                      ? "A flat, well-lit photo of the fabric works best."
                      : source === "GARMENT"
                        ? "A clear front photo of the garment (worn or flat)."
                        : "A hand-drawn or digital fashion sketch."
                  }
                  imageUrl={sourceImageId ? attachmentUrl(sourceImageId) : null}
                  busy={busy === "upload" || busy === "analyze"}
                  onFile={handleSourceFile}
                />
              </Card>
            </div>

            <div className="lg:col-span-2">
              <Card
                title="AI Analysis"
                subtitle={hasAnalysis ? "Click any value to correct it." : "Details appear here after upload."}
                right={
                  sourceImageId ? (
                    <button type="button" onClick={reanalyze} disabled={Boolean(busy)} className="text-xs font-medium text-violet-700 hover:underline disabled:opacity-50 dark:text-violet-300">
                      {busy === "analyze" ? "Analysing…" : "Re-analyse"}
                    </button>
                  ) : undefined
                }
              >
                {busy === "analyze" && (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="h-8 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                    ))}
                  </div>
                )}
                {busy !== "analyze" && !hasAnalysis && (
                  <p className="py-12 text-center text-sm text-zinc-400">No analysis yet.</p>
                )}
                {busy !== "analyze" && hasAnalysis && (
                  <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {(source === "FABRIC" ? FABRIC_FIELD_KEYS : GARMENT_ANALYSIS_FIELD_KEYS).map((key) => {
                      const label =
                        source === "FABRIC"
                          ? FABRIC_FIELD_LABELS[key as FabricFieldKey]
                          : GARMENT_ANALYSIS_FIELD_LABELS[key as GarmentAnalysisFieldKey];
                      const value =
                        source === "FABRIC"
                          ? ((project?.[key] as string | null) ?? "")
                          : (project?.sourceAnalysisJson?.[key] ?? "");
                      return <AnalysisRow key={`${key}-${value}`} label={label} value={value} onSave={(v) => saveAnalysisField(key, v)} />;
                    })}
                  </dl>
                )}
                {source === "FABRIC" && project?.fabricProduct && (
                  <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    ✓ Saved to Fabric Master as {project.fabricProduct.styleName} ({project.fabricProduct.styleCode})
                  </p>
                )}
              </Card>
            </div>
          </div>

          {source !== "FABRIC" && hasAnalysis && (
            <Card title="Suggested Fabrics from your Fabric Master" subtitle="Pick the fabric to make this design in — or upload a swatch.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {(fabricSuggestions ?? []).map((f) => {
                  const selected = project?.fabricProductId === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => selectFabric(f.id)}
                      disabled={Boolean(busy)}
                      className={`overflow-hidden rounded-xl border-2 text-left transition ${
                        selected ? "border-violet-500 shadow-md ring-2 ring-violet-200" : "border-zinc-200 hover:border-violet-300 dark:border-zinc-700"
                      }`}
                    >
                      {f.mainImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.mainImageUrl} alt={f.styleName} className="h-24 w-full object-cover" />
                      ) : (
                        <div className="flex h-24 items-center justify-center bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">No photo</div>
                      )}
                      <div className="p-2">
                        <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{f.styleName}</p>
                        <p className="text-[10px] text-zinc-500">{f.styleCode}</p>
                      </div>
                    </button>
                  );
                })}
                {fabricSuggestions && fabricSuggestions.length === 0 && (
                  <p className="col-span-full text-sm text-zinc-500">No fabrics in the Fabric Master yet — upload a swatch instead.</p>
                )}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <DropZone
                  compact
                  label="Or upload a fabric swatch"
                  hint="Used as the exact fabric for the design."
                  imageUrl={project?.fabricImageAttachmentId ? attachmentUrl(project.fabricImageAttachmentId) : null}
                  busy={busy === "swatch"}
                  onFile={(file) => uploadFile(`/api/v1/ai-designer/projects/${projectId}/fabric-image`, file, "swatch")}
                />
                {project?.fabricProductId && !project.fabricImageAttachmentId && (
                  <p className="self-center text-xs text-amber-700 dark:text-amber-300">
                    This fabric has no photo in the master — upload a swatch so AI can match its exact print and colour.
                  </p>
                )}
              </div>
            </Card>
          )}

          {hasAnalysis && (
            <Card title="Suggested Garments" subtitle="The closest match is selected automatically — tap another to change.">
              <div className="flex gap-3 overflow-x-auto pb-1">
                {suggestions.map((s, i) => {
                  const selected = project?.garmentTemplateKey === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => selectTemplate(s.key)}
                      disabled={Boolean(busy)}
                      className={`relative w-36 shrink-0 overflow-hidden rounded-xl border-2 text-left transition ${
                        selected ? "border-violet-500 shadow-lg ring-2 ring-violet-200" : "border-zinc-200 hover:border-violet-300 dark:border-zinc-700"
                      }`}
                    >
                      <TemplateThumb templateKey={s.key} className="h-44 w-full" />
                      {i === 0 && (
                        <span className="absolute left-2 top-2 rounded-full bg-gradient-to-r from-indigo-600 to-fuchsia-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          Best match
                        </span>
                      )}
                      <div className="p-2">
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{s.label}</p>
                        <p className="text-[10px] leading-tight text-zinc-500">{s.reason}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          <div className="flex justify-end">
            <PrimaryButton disabled={!canLeaveSource || Boolean(busy)} onClick={() => goTo("GARMENT")}>
              Next: Garment Type →
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- Step 2 */}
      {step === "GARMENT" && project && (
        <div className="space-y-5">
          <Card
            title="Select Garment Type"
            subtitle="Each type uses its own catalogue model photo — AI keeps the model and only changes the dress."
            right={
              <div className="flex flex-wrap gap-1">
                {TARGET_CUSTOMER_VALUES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCustomerFilter(c)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      customerFilter === c ? "bg-violet-600 text-white" : "bg-white text-zinc-600 hover:bg-violet-100 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {TARGET_CUSTOMER_LABELS[c]}
                  </button>
                ))}
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {templatesForCustomer.map((t) => {
                const selected = project.garmentTemplateKey === t.key && !project.customTemplateAttachmentId;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => selectTemplate(t.key)}
                    disabled={Boolean(busy)}
                    className={`group relative overflow-hidden rounded-2xl border-2 text-left transition ${
                      selected ? "border-violet-500 shadow-lg ring-2 ring-violet-200" : "border-zinc-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-zinc-700"
                    }`}
                  >
                    <TemplateThumb templateKey={t.key} className="h-56 w-full transition group-hover:scale-[1.02]" />
                    {selected && (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-violet-600 text-sm text-white shadow">✓</span>
                    )}
                    <div className="flex items-center justify-between p-3">
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{t.label}</span>
                      {!t.templateUrl && <span className="text-[10px] text-zinc-400">AI model</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card title="Or use your own garment / template" subtitle="Upload a model photo to dress in your fabric — overrides the type photo above.">
            <div className="max-w-sm">
              <DropZone
                compact
                label="Upload your own template"
                hint="A full-body model photo."
                imageUrl={project.customTemplateAttachmentId ? attachmentUrl(project.customTemplateAttachmentId) : null}
                busy={busy === "custom"}
                onFile={(file) => uploadFile(`/api/v1/ai-designer/projects/${project.id}/new-design/custom-template`, file, "custom")}
              />
            </div>
          </Card>

          <div className="flex justify-between">
            <button type="button" onClick={() => goTo("SOURCE")} className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400">
              ← Back
            </button>
            <PrimaryButton disabled={!project.garmentTemplateKey || Boolean(busy)} onClick={() => goTo("GENERATE")}>
              Next: Brand & Generate →
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- Step 3 */}
      {step === "GENERATE" && project && (
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-3">
            <Card title="Brand (optional)" subtitle="Add your brand name and logo to the design.">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Brand Name</span>
                  <input
                    value={brandDraft}
                    onChange={(e) => setBrandDraft(e.target.value)}
                    onBlur={saveBrandName}
                    placeholder="e.g. Indradhar"
                    className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <DropZone
                  compact
                  label="Upload logo"
                  hint="PNG with transparent background is best."
                  imageUrl={project.brandLogoAttachmentId ? attachmentUrl(project.brandLogoAttachmentId) : null}
                  busy={busy === "logo"}
                  onFile={(file) => uploadFile(`/api/v1/ai-designer/projects/${project.id}/branding/logo`, file, "logo")}
                />
              </div>
            </Card>

            <Card title="Environment" subtitle="Studio keeps the catalogue backdrop. Other settings replace only the background.">
              <div className="flex flex-wrap gap-2">
                {ENVIRONMENTS.map((env) => {
                  const selected = project.environmentKey === env.key;
                  return (
                    <button
                      key={env.key}
                      type="button"
                      onClick={() => saveEnvironment(env.key)}
                      disabled={Boolean(busy)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "border-violet-600 bg-violet-600 text-white shadow"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                      }`}
                    >
                      {env.label}
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card title="Generate Design" subtitle="AI dresses the model in your fabric.">
              <div className="flex gap-3">
                <div className="w-1/2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
                  {project.customTemplateAttachmentId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachmentUrl(project.customTemplateAttachmentId)} alt="Template" className="h-48 w-full object-cover object-top" />
                  ) : (
                    <TemplateThumb templateKey={project.garmentTemplateKey ?? ""} className="h-48 w-full" />
                  )}
                  <p className="px-2 py-1 text-center text-[11px] text-zinc-500">{selectedTemplate?.label ?? "Garment"}</p>
                </div>
                <div className="w-1/2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
                  {project.fabricImageAttachmentId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={attachmentUrl(project.fabricImageAttachmentId)} alt="Fabric" className="h-48 w-full object-cover" />
                  ) : (
                    <div className="flex h-48 items-center justify-center text-xs text-zinc-400">No fabric</div>
                  )}
                  <p className="px-2 py-1 text-center text-[11px] text-zinc-500">Fabric</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Number of designs</p>
                <div className="flex gap-2">
                  {([1, 3, 4] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setImageCount(n)}
                      className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
                        imageCount === n ? "border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <PrimaryButton disabled={Boolean(busy)} onClick={generate}>
                  {busy === "generate" ? "✨ Generating designs…" : "✨ Generate Design"}
                </PrimaryButton>
                {busy === "generate" && <p className="mt-2 text-xs text-zinc-500">This can take up to a minute.</p>}
              </div>
            </Card>
            <button type="button" onClick={() => goTo("GARMENT")} className="mt-3 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------- Step 4 */}
      {step === "DESIGNS" && project && (
        <Card
          title="Designs Created by AI"
          subtitle={`${images.length} design${images.length === 1 ? "" : "s"} — view the full design or open it in the AI studio.`}
          right={
            <button type="button" onClick={() => goTo("GENERATE")} className="text-xs font-medium text-violet-700 hover:underline dark:text-violet-300">
              + Generate more
            </button>
          }
        >
          {images.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-400">No designs yet — go back and generate.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {images.map((img) => (
                <div key={img.id} className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={attachmentUrl(img.imageAttachmentId)} alt="Generated design" className="h-80 w-full object-cover object-top" />
                    {img.decision === "SELECTED" && (
                      <span className="absolute left-2 top-2 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white">Selected</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => openDesign(img.id, "view")}
                      className="flex-1 rounded-lg border border-zinc-200 py-1.5 text-center text-xs font-semibold text-zinc-700 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => openDesign(img.id, "edit")}
                      className="flex-1 rounded-lg bg-gradient-to-r from-indigo-600 to-fuchsia-600 py-1.5 text-center text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Edit
                    </button>
                  </div>
                  {img.decision !== "SELECTED" && (
                    <div className="flex border-t border-zinc-100 text-[11px] dark:border-zinc-800">
                      <button type="button" onClick={() => decide(img.id, "SELECT")} className="flex-1 py-1.5 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30">
                        Select
                      </button>
                      <button type="button" onClick={() => decide(img.id, "REJECT")} className="flex-1 py-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30">
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function AnalysisRow({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className="grid grid-cols-5 gap-2 py-2">
      <dt className="col-span-2 text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="col-span-3 text-sm text-zinc-800 dark:text-zinc-100">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              if (draft !== value) onSave(draft);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-md border border-violet-300 px-2 py-0.5 text-sm dark:bg-zinc-950"
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="w-full text-left hover:text-violet-700 dark:hover:text-violet-300">
            {value || <span className="text-zinc-400">—</span>}
          </button>
        )}
      </dd>
    </div>
  );
}

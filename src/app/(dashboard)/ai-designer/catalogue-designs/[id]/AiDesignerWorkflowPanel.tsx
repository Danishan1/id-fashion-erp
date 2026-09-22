"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import {
  AGE_GROUPS_BY_CUSTOMER,
  PRODUCT_CATEGORIES_BY_CUSTOMER,
  TARGET_CUSTOMER_LABELS,
  TARGET_CUSTOMER_VALUES,
  type TargetCustomer,
} from "@/core/ai-designer/catalogs/customer-catalog";
import { ENVIRONMENTS } from "@/core/ai-designer/catalogs/environment-catalog";
import { FABRIC_FIELD_KEYS, type FabricFieldKey } from "@/modules/ai-designer/ai-designer.schema";
import { SKETCH_FEATURE_LABELS, SKETCH_TO_DESIGN_ATTRIBUTE_KEYS, type SketchFeatureKey } from "@/core/ai-designer/sketch-analysis/feature-registry";
import { STATUS_BADGE_CLASS, STATUS_LABELS, WIZARD_STEP_LABELS, stepsForCreationMode } from "../../statusLabels";
import { AiDesignerTechPackPanel, type TechPackData } from "./AiDesignerTechPackPanel";
import { SketchImageUploader } from "./SketchImageUploader";
import { SketchAnalysisPanel } from "./SketchAnalysisPanel";
import { ProductSuggestionsPanel } from "./ProductSuggestionsPanel";
import { LogoPositioner } from "./LogoPositioner";
import { AiSuggestedBadge } from "@/components/ui/AiSuggestedBadge";
import { GeneratedImageGrid, imageUrl, type AiDesignerImageRow } from "./GeneratedImageGrid";
import type { ProductSuggestionsResponse } from "@/core/ai-designer/product-suggestions/schema";

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
  fabricColor: "Color",
};

interface AiDesignerProjectData {
  id: string;
  projectNumber: string;
  projectName: string;
  status: keyof typeof STATUS_LABELS;
  creationMode: "STANDARD" | "SKETCH";
  currentStep: string;
  completedSteps: string[];
  sketchImageAttachmentId: string | null;
  fabricSource: "EXISTING" | "UPLOADED" | null;
  fabricProductId: string | null;
  fabricImageAttachmentId: string | null;
  fabricName: string | null;
  fabricCode: string | null;
  fabricComposition: string | null;
  fabricGsm: string | null;
  fabricWidth: string | null;
  fabricWeave: string | null;
  fabricStretch: string | null;
  fabricOpacity: string | null;
  fabricTexture: string | null;
  fabricPatternType: string | null;
  fabricPrintType: string | null;
  fabricSuitableSeason: string | null;
  fabricRecommendedGarments: string | null;
  fabricColor: string | null;
  productSuggestionsJson: ProductSuggestionsResponse | null;
  targetCustomer: TargetCustomer | null;
  ageGroup: string | null;
  productCategory: string | null;
  designSelectionsJson: Record<string, string> | null;
  modelGender: string | null;
  modelBodyType: string | null;
  modelPose: string | null;
  environmentKey: string | null;
  environmentLabel: string | null;
  isCustomEnvironment: boolean;
  secondFabricImageAttachmentId: string | null;
  secondFabricApplyAreas: string[];
  embellishmentMotifAttachmentId: string | null;
  brandName: string | null;
  brandLogoAttachmentId: string | null;
  logoXPercent: number | null;
  logoYPercent: number | null;
  logoWidthPercent: number | null;
  brandedImageAttachmentId: string | null;
  currentVersion: { currentImage: AiDesignerImageRow } | null;
  versions: { versionNumber: number; changeSummary: string | null; currentImage: AiDesignerImageRow }[];
  fabricProduct: { id: string; styleName: string; styleCode: string } | null;
}

const SECOND_FABRIC_APPLY_AREA_LABELS: Record<string, string> = {
  YOKE: "Yoke",
  SLEEVES: "Sleeves",
  BORDERS: "Borders / Hem",
  CONTRAST_PANELS: "Contrast Panels",
};

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * A single wizard-step tab panel — pure presentation, matches the numbered-
 * circle step-tracker language already used by Sampling's own
 * `SampleWorkflowPanel.tsx`. Only the one step selected via the stepper above
 * is ever mounted at all (direct user feedback: even a collapsed accordion
 * row for all 11 steps added up to real scrolling; true one-panel-at-a-time
 * tabs have none of that, and the stepper itself already doubles as the tab
 * strip, so there is no separate per-panel toggle control here). Never
 * touches the underlying wizard state (currentStep/completedSteps) — only
 * which already-rendered step's content exists in the DOM at once.
 */
function WizardSection({
  sectionRef,
  index,
  title,
  isDone,
  isCurrent,
  isOpen,
  children,
}: {
  sectionRef: (el: HTMLElement | null) => void;
  index: number;
  title: string;
  isDone: boolean;
  isCurrent: boolean;
  isOpen: boolean;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;
  return (
    <section ref={sectionRef} className="scroll-mt-20 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
            isDone
              ? "bg-green-600 text-white"
              : isCurrent
                ? "bg-indigo-600 text-white"
                : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
          }`}
        >
          {isDone ? "✓" : index}
        </span>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      </div>
      <div className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">{children}</div>
    </section>
  );
}

/**
 * The one and only way a step's content ever moves the wizard forward now
 * (see `goToNextStep` in the main component) — a step's own field changes
 * save immediately but never navigate on their own. Renders nothing on the
 * last step (`step` has no successor in `WIZARD_STEP_ORDER`).
 */
function StepNextButton({ step, steps, onNext }: { step: string; steps: readonly string[]; onNext: (afterStep: string) => void }) {
  const idx = steps.indexOf(step);
  const next = idx >= 0 ? steps[idx + 1] : undefined;
  if (!next) return null;
  return (
    <div className="mt-4 flex justify-end border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => onNext(step)}
        className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Next: {WIZARD_STEP_LABELS[next]} →
      </button>
    </div>
  );
}

export function AiDesignerWorkflowPanel({ projectId, initialProject }: { projectId: string; initialProject: AiDesignerProjectData }) {
  const [project, setProject] = useState(initialProject);
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSelectImage, setPendingSelectImage] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<AiDesignerImageRow[]>([]);
  const [secondFabricSelectedAreas, setSecondFabricSelectedAreas] = useState<string[]>([]);
  const [techPack, setTechPack] = useState<TechPackData | null>(null);
  const [sketchAnalysis, setSketchAnalysis] = useState<{
    id: string;
    status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
    sketchAnalysisSummary: string | null;
    observations: { id: string; featureKey: string; aiObservation: string; aiConfidence: string; approvedObservation: string; userEdited: boolean; isLocked: boolean }[];
  } | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState<{
    targetCustomer: string;
    ageGroup: string;
    productCategory: string;
    environmentKey: string;
  } | null>(null);
  /**
   * Per-card error for "Click to generate 3 sample designs →" — a real,
   * user-reported gap: the shared `error` banner above renders once at the
   * top of the whole panel, far from whichever suggestion card was actually
   * clicked, so a failure (e.g. every image-generation provider currently
   * down) looked like nothing had happened at all. Keyed by the same
   * `apply-suggestion-${groupIndex}-${itemIndex}` string already used for
   * `busy`, so ProductSuggestionsPanel can show the failure on the exact
   * card that failed instead of a generic top-of-page message.
   */
  const [suggestionErrors, setSuggestionErrors] = useState<Record<string, string>>({});
  const [brandDefaultName, setBrandDefaultName] = useState<string | null>(null);

  // Which single wizard step is currently the active "tab" — purely a display
  // concern, has no bearing on the real `currentStep`/`completedSteps` wizard
  // state. Only the real current step starts open, so a project that's
  // already progressed through several steps doesn't load as one long wall
  // of content. Exactly one step (or none) at a time, not a Set of
  // independently-toggled sections — switching steps is only ever done via
  // the stepper pills above (see jumpToStep), which both selects the new
  // step and deselects whatever was previously shown, the same way a tab
  // strip works. (Direct user feedback moved this twice: first from "every
  // step always visible" to a collapsible accordion where any number of rows
  // could be open at once, then to this single-active-tab model, since even
  // an all-collapsed accordion's 11 header rows still added up to real
  // scrolling.)
  const [expandedStep, setExpandedStep] = useState<string | null>(initialProject.currentStep);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const jumpToStep = (step: string) => {
    setExpandedStep(step);
    requestAnimationFrame(() => sectionRefs.current[step]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // Explicit forward navigation only, per direct user feedback: saving a
  // single field (e.g. picking one Product Design attribute out of several,
  // or one Target Customer button) used to immediately snap the whole panel
  // to whatever step the backend's `currentStep` recomputed to next — before
  // the user had finished with the current step, or had a chance to review
  // what they'd just picked. Every step's own explicit "Next →" button (below)
  // is now the only thing that ever advances `expandedStep` after the initial
  // load; saving a field no longer moves the view at all (see `reload`).
  const steps = stepsForCreationMode(project.creationMode);

  const goToNextStep = (afterStep: string) => {
    const idx = steps.indexOf(afterStep);
    const next = idx >= 0 ? steps[idx + 1] : undefined;
    if (next) jumpToStep(next);
  };

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((r) => r.json())
      .then((body) => setMaterials((body.data ?? []).filter((m: { materialCategory: string }) => m.materialCategory === "FABRIC")))
      .catch(() => {});
  }, []);

  // Loads the real, full image list on mount (not just the current version's
  // one image) — without this, a page reload lost every earlier generation's
  // images/decisions from the Step 9 gallery, showing it as empty even though
  // the database still had them.
  useEffect(() => {
    fetch(`/api/v1/ai-designer/projects/${projectId}/images`)
      .then((r) => r.json())
      .then((body) => setGeneratedImages(body.data ?? []))
      .catch(() => {});
  }, [projectId]);

  /** The Tech Pack step's own data survives a reload the same way the Step 9 image gallery does — reload() only ever refreshes the flat `project` row, which has nowhere to carry this. */
  useEffect(() => {
    fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack`)
      .then((r) => r.json())
      .then((body) => setTechPack(body.data ?? null))
      .catch(() => {});
  }, [projectId]);

  /** SKETCH mode only — same "own data, own fetch, survives a plain project reload" reasoning as techPack above; a no-op fetch for a STANDARD-mode project (the API returns null, harmlessly). */
  useEffect(() => {
    if (initialProject.creationMode !== "SKETCH") return;
    fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis`)
      .then((r) => r.json())
      .then((body) => setSketchAnalysis(body.data ?? null))
      .catch(() => {});
  }, [projectId, initialProject.creationMode]);

  // Resolves the effective brand-name default (the logged-in company's own
  // name) purely for the placeholder/prefill on the Branding step's input —
  // the project's own real, stored brandName (or lack of one) is what's
  // actually submitted either way.
  useEffect(() => {
    fetch(`/api/v1/ai-designer/projects/${projectId}/branding`)
      .then((r) => r.json())
      .then((body) => setBrandDefaultName(body.data?.effectiveBrandName ?? null))
      .catch(() => {});
  }, [projectId]);

  // Deliberately does NOT move `expandedStep` — the panel stays on whatever
  // step the user is currently looking at after any save, even though the
  // reloaded `project.currentStep`/`completedSteps` (driving the checkmarks
  // in the stepper above) may have already advanced. Moving forward is only
  // ever done by the user themselves, via a step's own "Next →" button.
  const reload = async () => {
    const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}`));
    setProject(body.data);
  };

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patchWizard = (payload: Record<string, unknown>) =>
    fetch(`/api/v1/ai-designer/projects/${projectId}/wizard-selections`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(parseJson);

  /**
   * Updates the just-decided image's own decision directly from the API
   * response, rather than relying on `reload()` — `reload()` only ever seeds
   * `generatedImages` once (when it's still empty) since the project's own
   * currentVersion only ever points at one image, so it has no way to refresh
   * an already-tracked image's decision after Select/Reject. Without this,
   * the card kept showing "PENDING" after a successful Select/Reject until a
   * full page reload, even though the database was already correct.
   */
  const decideImageAction = async (imageId: string, decision: "SELECT" | "REJECT", confirmed?: boolean) => {
    const body = await parseJson(
      await fetch(`/api/v1/ai-designer/projects/${projectId}/images/${imageId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, confirmed }),
      })
    );
    setGeneratedImages((prev) => prev.map((img) => (img.id === imageId ? { ...img, decision: body.data.decision } : img)));
  };

  /**
   * SKETCH mode only — wraps the shared `run()` (which only ever refreshes
   * the flat `project` row via reload()) with a follow-up sketch-analysis
   * refetch, the same "own data, own refresh" need techPack's own dedicated
   * onChanged callback already solves differently. Used by both
   * SketchImageUploader (uploading/removing a sketch marks any existing
   * analysis STALE server-side) and SketchAnalysisPanel (every one of its
   * own actions mutates the analysis directly).
   */
  const runSketch = async (key: string, fn: () => Promise<unknown>) => {
    await run(key, fn);
    const body = await fetch(`/api/v1/ai-designer/projects/${projectId}/sketch-analysis`)
      .then((r) => r.json())
      .catch(() => ({ data: null }));
    setSketchAnalysis(body.data ?? null);
  };

  /**
   * The literal "click a suggested product" action — applies the AI's own
   * exact suggestion (Target Customer/Age Group/Product Category/
   * Environment) AND generates 3 designs in one server round trip. Appends
   * the 3 new images to the existing gallery the same way the plain
   * Generate button does, so they show up immediately without a full page
   * reload. run()'s own reload() already refreshes targetCustomer/ageGroup/
   * productCategory/environmentLabel for free, since applyProductSuggestionAndGenerate()
   * saves them through the same saveWizardSelections() the manual steps use.
   */
  const applySuggestion = async (groupIndex: number, itemIndex: number) => {
    const key = `apply-suggestion-${groupIndex}-${itemIndex}`;
    setBusy(key);
    setSuggestionErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const body = await parseJson(
        await fetch(`/api/v1/ai-designer/projects/${projectId}/product-suggestions/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupIndex, itemIndex }),
        })
      );
      setGeneratedImages((prev) => [
        ...prev,
        ...body.data.images.map((img: AiDesignerImageRow) => ({ ...img, suggestionContext: body.data.appliedSuggestion })),
      ]);
      setSuggestionApplied(body.data.appliedSuggestion);
      await reload();
    } catch (err) {
      setSuggestionErrors((prev) => ({ ...prev, [key]: (err as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  /**
   * Explicit "Skip this step" — the step was already navigable-past via the
   * wizard's own unconditional Next button (nothing downstream requires
   * suggestions), but skipping that way never marked it complete, leaving
   * the stepper checkmark permanently unchecked even after a deliberate
   * skip — a real, reported gap. Marks it complete server-side with no AI
   * call, then moves on exactly like the step's own Next button would.
   */
  const skipSuggestions = () =>
    run("skip-suggestions", () =>
      fetch(`/api/v1/ai-designer/projects/${projectId}/product-suggestions/skip`, { method: "POST" }).then(parseJson)
    ).then(() => goToNextStep("PRODUCT_SUGGESTIONS"));

  const ageGroups = project.targetCustomer ? AGE_GROUPS_BY_CUSTOMER[project.targetCustomer] : [];
  const productCategories = project.targetCustomer ? PRODUCT_CATEGORIES_BY_CUSTOMER[project.targetCustomer] : [];
  const designSelections = project.designSelectionsJson ?? {};

  const currentImage = project.currentVersion?.currentImage ?? null;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "AI Designer", href: "/ai-designer" },
          { label: project.projectNumber },
        ]}
      />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {project.projectNumber} — {project.projectName}
          </h1>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[project.status]}`}>
          {STATUS_LABELS[project.status]}
        </span>
      </div>

      {/* Progress stepper — each pill is a real control now: click to jump to
          (and expand) that step's section below, instead of purely decorative
          status text with no navigation behind it. */}
      <div className="flex flex-wrap gap-2 text-xs">
        {steps.map((step, i) => {
          const done = project.completedSteps.includes(step);
          const current = project.currentStep === step;
          return (
            <button
              key={step}
              type="button"
              onClick={() => jumpToStep(step)}
              aria-current={current ? "step" : undefined}
              title={`Go to ${WIZARD_STEP_LABELS[step]}`}
              className={`rounded-full px-2 py-1 transition hover:opacity-80 ${
                done
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : current
                    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {done ? "✓ " : `${i + 1}. `}
              {WIZARD_STEP_LABELS[step]}
            </button>
          );
        })}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      {/* SKETCH mode only — Upload Sketch / Sketch Analysis, before every other step (which is reused completely unchanged for either mode). */}
      {project.creationMode === "SKETCH" && (
        <>
          <WizardSection
            sectionRef={(el) => (sectionRefs.current.UPLOAD_SKETCH = el)}
            index={steps.indexOf("UPLOAD_SKETCH") + 1}
            title="Upload Sketch"
            isDone={project.completedSteps.includes("UPLOAD_SKETCH")}
            isCurrent={project.currentStep === "UPLOAD_SKETCH"}
            isOpen={expandedStep === "UPLOAD_SKETCH"}
          >
            <SketchImageUploader projectId={projectId} sketchImageAttachmentId={project.sketchImageAttachmentId} busy={busy} run={runSketch} />
            <StepNextButton step="UPLOAD_SKETCH" steps={steps} onNext={goToNextStep} />
          </WizardSection>

          <WizardSection
            sectionRef={(el) => (sectionRefs.current.SKETCH_ANALYSIS = el)}
            index={steps.indexOf("SKETCH_ANALYSIS") + 1}
            title="Sketch Analysis"
            isDone={project.completedSteps.includes("SKETCH_ANALYSIS")}
            isCurrent={project.currentStep === "SKETCH_ANALYSIS"}
            isOpen={expandedStep === "SKETCH_ANALYSIS"}
          >
            <SketchAnalysisPanel
              projectId={projectId}
              hasSketchImage={!!project.sketchImageAttachmentId}
              analysis={sketchAnalysis}
              busy={busy}
              run={runSketch}
            />
            <StepNextButton step="SKETCH_ANALYSIS" steps={steps} onNext={goToNextStep} />
          </WizardSection>
        </>
      )}

      {/* Step 1 — Fabric Selection */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.FABRIC_SELECTION = el)}
        index={steps.indexOf("FABRIC_SELECTION") + 1}
        title="Fabric Selection"
        isDone={project.completedSteps.includes("FABRIC_SELECTION")}
        isCurrent={project.currentStep === "FABRIC_SELECTION"}
        isOpen={expandedStep === "FABRIC_SELECTION"}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-zinc-500">Pick from Fabric Master (name/code/supplier only — optional)</p>
            <div className="mt-1">
              <MaterialPicker
                materials={materials}
                value={project.fabricProductId ?? ""}
                onChange={(id) => run("select-fabric", () => fetch(`/api/v1/ai-designer/projects/${projectId}/fabric-existing`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ fabricProductId: id }),
                }).then(parseJson))}
                placeholder="Search existing fabric…"
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
              Upload the fabric&apos;s real photo <span className="text-red-500">(required to Generate Design)</span>
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              The generated design uses this exact photo as the fabric — the Fabric Master above has no photo of its
              own, so even if you picked an existing fabric, you must still upload its actual image here.
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mt-2 block w-full text-sm"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const formData = new FormData();
                formData.append("file", file);
                run("upload-fabric", () =>
                  fetch(`/api/v1/ai-designer/projects/${projectId}/fabric-image`, { method: "POST", body: formData }).then(parseJson)
                );
                e.target.value = "";
              }}
            />
            {project.fabricImageAttachmentId && (
              <div className="mt-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl(project.fabricImageAttachmentId)}
                  alt="Real fabric reference"
                  className="h-24 w-24 rounded border object-cover"
                />
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => run("delete-fabric-image", () => fetch(`/api/v1/ai-designer/projects/${projectId}/fabric-image`, { method: "DELETE" }).then(parseJson))}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
        <StepNextButton step="FABRIC_SELECTION" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 2 — Analyze Fabric with AI */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.FABRIC_ANALYSIS = el)}
        index={steps.indexOf("FABRIC_ANALYSIS") + 1}
        title="Analyze Fabric with AI"
        isDone={project.completedSteps.includes("FABRIC_ANALYSIS")}
        isCurrent={project.currentStep === "FABRIC_ANALYSIS"}
        isOpen={expandedStep === "FABRIC_ANALYSIS"}
      >
        <p className="text-xs text-zinc-500">Fabric Name, Composition, GSM, Width, Weave, Stretch, Opacity, Texture, Pattern Type, Print Type, Suitable Season, Recommended Garments.</p>
        <button
          type="button"
          disabled={busy === "analyze" || !project.fabricImageAttachmentId}
          onClick={() => run("analyze", () => fetch(`/api/v1/ai-designer/projects/${projectId}/fabric-analysis`, { method: "POST" }).then(parseJson))}
          className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === "analyze" ? "Analyzing…" : "Analyze Fabric With AI"}
        </button>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FABRIC_FIELD_KEYS.map((key) => (
            <FormField key={key} label={FABRIC_FIELD_LABELS[key]} htmlFor={key}>
              <input
                id={key}
                className={textInputClass()}
                defaultValue={(project as unknown as Record<string, string | null>)[key] ?? ""}
                onBlur={(e) => {
                  const value = e.target.value;
                  if (value === ((project as unknown as Record<string, string | null>)[key] ?? "")) return;
                  run("field", () =>
                    fetch(`/api/v1/ai-designer/projects/${projectId}/fabric-analysis`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ field: key, value }),
                    }).then(parseJson)
                  );
                }}
              />
            </FormField>
          ))}
        </div>
        <StepNextButton step="FABRIC_ANALYSIS" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 2b — AI Product Suggestions */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.PRODUCT_SUGGESTIONS = el)}
        index={steps.indexOf("PRODUCT_SUGGESTIONS") + 1}
        title="AI Product Suggestions"
        isDone={project.completedSteps.includes("PRODUCT_SUGGESTIONS")}
        isCurrent={project.currentStep === "PRODUCT_SUGGESTIONS"}
        isOpen={expandedStep === "PRODUCT_SUGGESTIONS"}
      >
        <ProductSuggestionsPanel
          hasFabric={!!project.fabricName}
          suggestions={project.productSuggestionsJson}
          busy={busy}
          errors={suggestionErrors}
          generatedImages={generatedImages.filter((img) => img.fromSuggestion)}
          onRun={() => run("run-suggestions", () => fetch(`/api/v1/ai-designer/projects/${projectId}/product-suggestions`, { method: "POST" }).then(parseJson))}
          onApply={applySuggestion}
          onSelectImage={setPendingSelectImage}
          onRejectImage={(id) => run("reject", () => decideImageAction(id, "REJECT"))}
          onSkip={skipSuggestions}
        />
        <StepNextButton step="PRODUCT_SUGGESTIONS" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 3 — Target Customer */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.TARGET_CUSTOMER = el)}
        index={steps.indexOf("TARGET_CUSTOMER") + 1}
        title="Target Customer"
        isDone={project.completedSteps.includes("TARGET_CUSTOMER")}
        isCurrent={project.currentStep === "TARGET_CUSTOMER"}
        isOpen={expandedStep === "TARGET_CUSTOMER"}
      >
        {suggestionApplied && project.targetCustomer === suggestionApplied.targetCustomer && (
          <div className="mb-2">
            <AiSuggestedBadge />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {TARGET_CUSTOMER_VALUES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => run("customer", () => patchWizard({ targetCustomer: c }))}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                project.targetCustomer === c
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              {TARGET_CUSTOMER_LABELS[c]}
            </button>
          ))}
        </div>
        <StepNextButton step="TARGET_CUSTOMER" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 4 — Age Group */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.AGE_GROUP = el)}
        index={steps.indexOf("AGE_GROUP") + 1}
        title="Age Group"
        isDone={project.completedSteps.includes("AGE_GROUP")}
        isCurrent={project.currentStep === "AGE_GROUP"}
        isOpen={expandedStep === "AGE_GROUP"}
      >
        {!project.targetCustomer && <p className="text-xs text-zinc-500">Pick a Target Customer first.</p>}
        {suggestionApplied && project.ageGroup === suggestionApplied.ageGroup && (
          <div className="mb-2">
            <AiSuggestedBadge />
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {ageGroups.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => run("age", () => patchWizard({ ageGroup: a }))}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                project.ageGroup === a
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <StepNextButton step="AGE_GROUP" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 5 — Product Category */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.PRODUCT_CATEGORY = el)}
        index={steps.indexOf("PRODUCT_CATEGORY") + 1}
        title="Product Category"
        isDone={project.completedSteps.includes("PRODUCT_CATEGORY")}
        isCurrent={project.currentStep === "PRODUCT_CATEGORY"}
        isOpen={expandedStep === "PRODUCT_CATEGORY"}
      >
        {!project.targetCustomer && <p className="text-xs text-zinc-500">Pick a Target Customer first.</p>}
        {suggestionApplied && project.productCategory === suggestionApplied.productCategory && (
          <div className="mb-2">
            <AiSuggestedBadge />
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {productCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => run("category", () => patchWizard({ productCategory: c }))}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                project.productCategory === c
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <StepNextButton step="PRODUCT_CATEGORY" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 8 — Environment (Model step hidden for now, per explicit request; Product Design step hidden for now, per explicit request) */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.ENVIRONMENT = el)}
        index={steps.indexOf("ENVIRONMENT") + 1}
        title="Environment"
        isDone={project.completedSteps.includes("ENVIRONMENT")}
        isCurrent={project.currentStep === "ENVIRONMENT"}
        isOpen={expandedStep === "ENVIRONMENT"}
      >
        {suggestionApplied && project.environmentKey === suggestionApplied.environmentKey && (
          <div className="mb-2">
            <AiSuggestedBadge />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {ENVIRONMENTS.map((env) => (
            <button
              key={env.key}
              type="button"
              onClick={() => run("environment", () => patchWizard({ environmentKey: env.key }))}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                !project.isCustomEnvironment && project.environmentKey === env.key
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
              }`}
            >
              {env.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <FormField label="Or describe a custom environment" htmlFor="customEnvironment">
            <input
              id="customEnvironment"
              className={textInputClass()}
              defaultValue={project.isCustomEnvironment ? project.environmentLabel ?? "" : ""}
              placeholder="e.g. a sunlit rooftop terrace at golden hour"
              onBlur={(e) => {
                if (!e.target.value) return;
                run("environment", () => patchWizard({ isCustomEnvironment: true, environmentLabel: e.target.value }));
              }}
            />
          </FormField>
        </div>
        <StepNextButton step="ENVIRONMENT" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 9 — Generate Design */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.GENERATE = el)}
        index={steps.indexOf("GENERATE") + 1}
        title="Generate Design"
        isDone={project.completedSteps.includes("GENERATE")}
        isCurrent={project.currentStep === "GENERATE"}
        isOpen={expandedStep === "GENERATE"}
      >
        {project.creationMode === "SKETCH" && (
          <div className="mb-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Design Summary</p>
            <div className="mt-2 flex flex-wrap gap-4">
              {project.sketchImageAttachmentId && (
                <div>
                  <p className="text-[11px] text-zinc-500">Sketch</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(project.sketchImageAttachmentId)} alt="Sketch" className="mt-1 h-20 w-20 rounded border object-contain bg-white" />
                </div>
              )}
              {project.fabricImageAttachmentId && (
                <div>
                  <p className="text-[11px] text-zinc-500">Fabric</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(project.fabricImageAttachmentId)} alt="Fabric" className="mt-1 h-20 w-20 rounded border object-cover" />
                </div>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-zinc-500">Target</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{project.targetCustomer ? TARGET_CUSTOMER_LABELS[project.targetCustomer] : "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Age Group</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{project.ageGroup || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Category</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{project.productCategory || "—"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Model</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{[project.modelGender, project.modelBodyType, project.modelPose].filter(Boolean).join(", ") || "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-zinc-500">Environment</dt>
                <dd className="text-zinc-800 dark:text-zinc-200">{project.environmentLabel || "—"}</dd>
              </div>
            </dl>
            {(() => {
              const observations = sketchAnalysis?.observations ?? [];
              const modifications = observations
                .filter((o) => o.isLocked)
                .flatMap((o) => {
                  const attrKeys = SKETCH_TO_DESIGN_ATTRIBUTE_KEYS[o.featureKey as SketchFeatureKey];
                  if (!attrKeys) return [];
                  const selected = attrKeys.map((k) => designSelections[k]).find((v) => v && v.trim().length > 0);
                  if (!selected) return [];
                  return [`${SKETCH_FEATURE_LABELS[o.featureKey as SketchFeatureKey] ?? o.featureKey} → ${selected}`];
                });
              return modifications.length > 0 ? (
                <div className="mt-3">
                  <p className="text-[11px] font-medium text-zinc-500">Design Modifications (explicit overrides from the sketch)</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-zinc-800 dark:text-zinc-200">
                    {modifications.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })()}
          </div>
        )}
        <div className="flex gap-2">
          {[1, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              disabled={busy === "generate"}
              onClick={() =>
                run("generate", async () => {
                  const body = await parseJson(
                    await fetch(`/api/v1/ai-designer/projects/${projectId}/generate`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ imageCount: n }),
                    })
                  );
                  setGeneratedImages((prev) => [...prev, ...body.data.images]);
                })
              }
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700"
            >
              {busy === "generate" ? "Generating…" : `Generate ${n} image${n > 1 ? "s" : ""}`}
            </button>
          ))}
        </div>

        {generatedImages.length > 0 && (
          <div className="mt-4">
            <GeneratedImageGrid
              images={generatedImages}
              onSelect={setPendingSelectImage}
              onReject={(id) => run("reject", () => decideImageAction(id, "REJECT"))}
            />
          </div>
        )}
        <StepNextButton step="GENERATE" steps={steps} onNext={goToNextStep} />
      </WizardSection>

      {/* Step 10 — Multi-Fabric */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.MULTI_FABRIC = el)}
          index={steps.indexOf("MULTI_FABRIC") + 1}
          title="Multi-Fabric"
          isDone={project.completedSteps.includes("MULTI_FABRIC")}
          isCurrent={project.currentStep === "MULTI_FABRIC"}
          isOpen={expandedStep === "MULTI_FABRIC"}
        >
          <p className="text-xs text-zinc-500">
            Optional. Apply a second fabric to specific area(s) of the current design — e.g. a contrast yoke, sleeves,
            borders, or panels.
          </p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Second Fabric</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-2 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  run("upload-second-fabric", () =>
                    fetch(`/api/v1/ai-designer/projects/${projectId}/second-fabric-image`, { method: "POST", body: formData }).then(parseJson)
                  );
                  e.target.value = "";
                }}
              />
              {project.secondFabricImageAttachmentId && (
                <div className="mt-2 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(project.secondFabricImageAttachmentId)}
                    alt="Second fabric reference"
                    className="h-24 w-24 rounded border object-cover"
                  />
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() =>
                      run("delete-second-fabric", () =>
                        fetch(`/api/v1/ai-designer/projects/${projectId}/second-fabric-image`, { method: "DELETE" }).then(parseJson)
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Apply Second Fabric To</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(SECOND_FABRIC_APPLY_AREA_LABELS).map(([area, label]) => {
                  const selected = secondFabricSelectedAreas.includes(area);
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSecondFabricSelectedAreas((prev) => (selected ? prev.filter((a) => a !== area) : [...prev, area]))
                      }
                      className={`rounded-md border px-3 py-1.5 text-left text-sm ${
                        selected
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={busy === "apply-second-fabric" || !project.secondFabricImageAttachmentId || secondFabricSelectedAreas.length === 0}
                onClick={() =>
                  run("apply-second-fabric", () =>
                    fetch(`/api/v1/ai-designer/projects/${projectId}/apply-second-fabric`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ applyAreas: secondFabricSelectedAreas }),
                    }).then(parseJson)
                  )
                }
                className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy === "apply-second-fabric" ? "Applying…" : "Apply Second Fabric"}
              </button>
            </div>
          </div>
          <StepNextButton step="MULTI_FABRIC" steps={steps} onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 12 — Edit Design (Embellishments step hidden for now, per explicit request — still fully reachable from the Edit Design workspace's own Embellishments tab) */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.EDIT = el)}
          index={steps.indexOf("EDIT") + 1}
          title="Edit Design"
          isDone={project.completedSteps.includes("EDIT")}
          isCurrent={project.currentStep === "EDIT"}
          isOpen={expandedStep === "EDIT"}
        >
          <p className="text-xs text-zinc-500">
            A full single-page design workspace — canvas with zoom/pan, contextual edit categories, Quick/Technical/AI Prompt
            edit modes, AI variations review, before/after compare, and version history with Approve/Reject.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(currentImage.imageAttachmentId)} alt="Current design" className="h-32 w-32 rounded border object-cover" />
            <Link
              href={`/ai-designer/catalogue-designs/${projectId}/edit`}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Open Design Editor →
            </Link>
          </div>
          <StepNextButton step="EDIT" steps={steps} onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 12b — Branding */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.BRANDING = el)}
          index={steps.indexOf("BRANDING") + 1}
          title="Branding"
          isDone={project.completedSteps.includes("BRANDING")}
          isCurrent={project.currentStep === "BRANDING"}
          isOpen={expandedStep === "BRANDING"}
        >
          <FormField label="Brand Name (optional)" htmlFor="brandName">
            <input
              id="brandName"
              className={textInputClass()}
              defaultValue={project.brandName ?? brandDefaultName ?? ""}
              placeholder={brandDefaultName ? `Defaults to "${brandDefaultName}"` : undefined}
              onBlur={(e) => {
                if (e.target.value === (project.brandName ?? "")) return;
                run("brand-name", () =>
                  fetch(`/api/v1/ai-designer/projects/${projectId}/branding`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ brandName: e.target.value }),
                  }).then(parseJson)
                );
              }}
            />
          </FormField>
          <div className="mt-4">
            <LogoPositioner
              projectId={projectId}
              designImageAttachmentId={currentImage.imageAttachmentId}
              logoAttachmentId={project.brandLogoAttachmentId}
              logoXPercent={project.logoXPercent}
              logoYPercent={project.logoYPercent}
              logoWidthPercent={project.logoWidthPercent}
              brandedImageAttachmentId={project.brandedImageAttachmentId}
              busy={busy}
              run={run}
            />
          </div>
          <StepNextButton step="BRANDING" steps={steps} onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 13 — Tech Pack */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.TECH_PACK = el)}
          index={steps.indexOf("TECH_PACK") + 1}
          title="Tech Pack"
          isDone={project.completedSteps.includes("TECH_PACK")}
          isCurrent={project.currentStep === "TECH_PACK"}
          isOpen={expandedStep === "TECH_PACK"}
        >
          <AiDesignerTechPackPanel
            projectId={projectId}
            techPack={techPack}
            busy={busy === "tech-pack"}
            onGenerate={() =>
              run("tech-pack", async () => {
                const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack`, { method: "POST" }));
                setTechPack(body.data);
              })
            }
            onChanged={setTechPack}
          />

          <StepNextButton step="TECH_PACK" steps={steps} onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Version History — supplementary, read-only; not part of the numbered
          wizard sequence above, so it gets its own lightweight disclosure
          rather than a numbered-circle WizardSection. */}
      {project.versions.length > 0 && (
        <section className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setVersionsOpen((v) => !v)}
            aria-expanded={versionsOpen}
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
          >
            <h2 className="flex-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Version History <span className="font-normal text-zinc-400">({project.versions.length})</span>
            </h2>
            <span className={`shrink-0 text-zinc-400 transition-transform ${versionsOpen ? "rotate-180" : ""}`} aria-hidden="true">
              ▾
            </span>
          </button>
          {versionsOpen && (
            <div className="space-y-2 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
              {project.versions.map((v) => (
                <div key={v.versionNumber} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 font-medium">v{v.versionNumber}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(v.currentImage.imageAttachmentId)} alt={`Version ${v.versionNumber}`} className="h-10 w-10 rounded border object-cover" />
                  <span className="text-zinc-500">{v.changeSummary}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Step 14 — Export */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.EXPORT = el)}
          index={steps.indexOf("EXPORT") + 1}
          title="Export"
          isDone={project.completedSteps.includes("EXPORT")}
          isCurrent={project.currentStep === "EXPORT"}
          isOpen={expandedStep === "EXPORT"}
        >
          <div className="flex gap-2">
            {(["png", "jpg", "pdf"] as const).map((fmt) => (
              <a
                key={fmt}
                href={`/api/v1/ai-designer/projects/${projectId}/export?format=${fmt}`}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm uppercase hover:bg-zinc-50 dark:border-zinc-700"
              >
                {fmt}
              </a>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500">DXF export and a full Tech Pack export are future support.</p>
        </WizardSection>
      )}

      <ConfirmModal
        open={pendingSelectImage !== null}
        title="Select this design as the final visual?"
        message="This marks the image as your selected design for this project."
        confirmLabel="Select"
        isBusy={busy === "select"}
        onConfirm={() =>
          run("select", async () => {
            // Re-apply the SELECTED image's own originating suggestion
            // (Target Customer/Age Group/Product Category/Environment) —
            // generating from a later suggestion overwrites those fields on
            // the project, so without this, selecting an image from an
            // earlier suggestion would leave them mismatched with whichever
            // suggestion was clicked last, not the one actually selected.
            const img = generatedImages.find((i) => i.id === pendingSelectImage);
            if (img?.suggestionContext) {
              await patchWizard(img.suggestionContext);
            }
            await decideImageAction(pendingSelectImage!, "SELECT", true);
          }).then(() => setPendingSelectImage(null))
        }
        onCancel={() => setPendingSelectImage(null)}
      />
    </div>
  );
}

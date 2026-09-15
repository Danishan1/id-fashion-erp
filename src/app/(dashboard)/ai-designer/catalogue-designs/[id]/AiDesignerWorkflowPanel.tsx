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
import type { DesignAttributeDef } from "@/core/ai-designer/catalogs/design-attribute-catalog";
import { DesignOptionImage } from "@/core/ai-designer/catalogs/design-icon-catalog";
import { ENVIRONMENTS } from "@/core/ai-designer/catalogs/environment-catalog";
import { BODY_TYPES, MODEL_GENDERS, POSES } from "@/core/ai-designer/catalogs/model-catalog";
import { FABRIC_FIELD_KEYS, type FabricFieldKey } from "@/modules/ai-designer/ai-designer.schema";
import { useAiDesignerDisplayMode } from "@/lib/use-ai-designer-display-mode";
import { STATUS_BADGE_CLASS, STATUS_LABELS, WIZARD_STEP_LABELS, WIZARD_STEP_ORDER } from "../../statusLabels";
import { AiDesignerTechPackPanel, type TechPackData } from "./AiDesignerTechPackPanel";

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

interface AiDesignerImageRow {
  id: string;
  generationId: string;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  createdAt: string;
}

interface AiDesignerProjectData {
  id: string;
  projectNumber: string;
  projectName: string;
  status: keyof typeof STATUS_LABELS;
  currentStep: string;
  completedSteps: string[];
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

const EMBELLISHMENT_TYPE_LABELS: Record<string, string> = {
  DIGITAL_APPLIQUE: "Digital Applique",
  EMBROIDERY: "Embroidery",
  SEQUIN_WORK: "Sequin Work",
  LACE_TRIM: "Lace Trim",
  BEADWORK: "Beadwork",
  PATCHWORK: "Patchwork",
};

function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

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
function StepNextButton({ step, onNext }: { step: string; onNext: (afterStep: string) => void }) {
  const idx = WIZARD_STEP_ORDER.indexOf(step as (typeof WIZARD_STEP_ORDER)[number]);
  const next = idx >= 0 ? WIZARD_STEP_ORDER[idx + 1] : undefined;
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
  const [embellishmentType, setEmbellishmentType] = useState<string>("DIGITAL_APPLIQUE");
  const [embellishmentInstructions, setEmbellishmentInstructions] = useState("");
  const [techPack, setTechPack] = useState<TechPackData | null>(null);
  const [designAttributes, setDesignAttributes] = useState<DesignAttributeDef[]>([]);
  const [activeDesignAttrKey, setActiveDesignAttrKey] = useState<string | null>(null);
  const [optionReferenceImages, setOptionReferenceImages] = useState<Record<string, string>>({});

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
  const goToNextStep = (afterStep: string) => {
    const idx = WIZARD_STEP_ORDER.indexOf(afterStep as (typeof WIZARD_STEP_ORDER)[number]);
    const next = idx >= 0 ? WIZARD_STEP_ORDER[idx + 1] : undefined;
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

  // Product Design's own attribute list is now a real, per-company master
  // (Masters -> AI Design -> Product Design), not a static import — this
  // company's own customized rows for the category once any exist, else the
  // original built-in defaults (see ai-designer-attribute-master.service.ts).
  useEffect(() => {
    const category = project.productCategory;
    if (!category) return;
    fetch(`/api/v1/ai-designer/product-design-attributes/effective?category=${encodeURIComponent(category)}`)
      .then((r) => r.json())
      .then((body) => setDesignAttributes(body.data ?? []))
      .catch(() => setDesignAttributes([]));
  }, [project.productCategory]);

  // Admin-uploaded photo overrides (Masters -> AI Design -> Product Design ->
  // Reference Photos) — a flat { optionValue -> attachmentId } map fetched
  // once, company-wide (not per-category), since the same option value's
  // photo applies everywhere it appears. Missing from this map just means
  // "no override yet" -- DesignOptionImage falls back to the AI-generated
  // static photo, then the clipart icon, same as before this existed.
  useEffect(() => {
    fetch("/api/v1/ai-designer/product-design-attributes/reference-images")
      .then((r) => r.json())
      .then((body) => {
        const map: Record<string, string> = {};
        for (const row of body.data ?? []) {
          if (row.attachmentId) map[row.optionValue] = row.attachmentId;
        }
        setOptionReferenceImages(map);
      })
      .catch(() => setOptionReferenceImages({}));
  }, []);

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

  const ageGroups = project.targetCustomer ? AGE_GROUPS_BY_CUSTOMER[project.targetCustomer] : [];
  const productCategories = project.targetCustomer ? PRODUCT_CATEGORIES_BY_CUSTOMER[project.targetCustomer] : [];
  const designSelections = project.designSelectionsJson ?? {};
  const designDisplayMode = useAiDesignerDisplayMode();
  const activeDesignAttr = designAttributes.find((a) => a.key === activeDesignAttrKey) ?? designAttributes[0];

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
        {WIZARD_STEP_ORDER.map((step, i) => {
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

      {/* Step 1 — Fabric Selection */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.FABRIC_SELECTION = el)}
        index={1}
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
        <StepNextButton step="FABRIC_SELECTION" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 2 — Analyze Fabric with AI */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.FABRIC_ANALYSIS = el)}
        index={2}
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
        <StepNextButton step="FABRIC_ANALYSIS" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 3 — Target Customer */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.TARGET_CUSTOMER = el)}
        index={3}
        title="Target Customer"
        isDone={project.completedSteps.includes("TARGET_CUSTOMER")}
        isCurrent={project.currentStep === "TARGET_CUSTOMER"}
        isOpen={expandedStep === "TARGET_CUSTOMER"}
      >
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
        <StepNextButton step="TARGET_CUSTOMER" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 4 — Age Group */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.AGE_GROUP = el)}
        index={4}
        title="Age Group"
        isDone={project.completedSteps.includes("AGE_GROUP")}
        isCurrent={project.currentStep === "AGE_GROUP"}
        isOpen={expandedStep === "AGE_GROUP"}
      >
        {!project.targetCustomer && <p className="text-xs text-zinc-500">Pick a Target Customer first.</p>}
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
        <StepNextButton step="AGE_GROUP" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 5 — Product Category */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.PRODUCT_CATEGORY = el)}
        index={5}
        title="Product Category"
        isDone={project.completedSteps.includes("PRODUCT_CATEGORY")}
        isCurrent={project.currentStep === "PRODUCT_CATEGORY"}
        isOpen={expandedStep === "PRODUCT_CATEGORY"}
      >
        {!project.targetCustomer && <p className="text-xs text-zinc-500">Pick a Target Customer first.</p>}
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
        <StepNextButton step="PRODUCT_CATEGORY" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 6 — Product Design */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.PRODUCT_DESIGN = el)}
        index={6}
        title="Product Design"
        isDone={project.completedSteps.includes("PRODUCT_DESIGN")}
        isCurrent={project.currentStep === "PRODUCT_DESIGN"}
        isOpen={expandedStep === "PRODUCT_DESIGN"}
      >
        {!project.productCategory && <p className="text-xs text-zinc-500">Pick a Product Category first.</p>}

        {/* Category grid — label-only, no options shown here. Pick one to
            open its own options panel below, instead of showing every
            category's full option grid open at once (direct user feedback,
            matched against a competitor reference: a flat "everything open"
            layout got long/unwieldy once a category had 15+ attributes). */}
        <div className="mt-3 flex flex-wrap gap-2">
          {designAttributes.map((attr) => {
            const isActive = activeDesignAttr?.key === attr.key;
            const hasSelection = !!designSelections[attr.key];
            return (
              <button
                key={attr.key}
                type="button"
                onClick={() => setActiveDesignAttrKey(attr.key)}
                className={`rounded-md border px-3 py-1.5 text-xs transition ${
                  isActive
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
                }`}
              >
                {attr.label}
                {hasSelection && <span className={isActive ? "ml-1 text-white" : "ml-1 text-indigo-600 dark:text-indigo-400"}>●</span>}
              </button>
            );
          })}
        </div>

        {activeDesignAttr && (
          <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{activeDesignAttr.label}</p>
            <p className="mb-2 mt-0.5 text-xs text-zinc-500">Choose one option below — it will be used when the design is generated.</p>
            <div
              className={
                designDisplayMode === "TEXT" ? "flex flex-wrap gap-2" : "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
              }
            >
              {activeDesignAttr.options.map((opt) => {
                const selected = designSelections[activeDesignAttr.key] === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => run("design", () => patchWizard({ designSelections: { [activeDesignAttr.key]: opt } }))}
                    className={
                      designDisplayMode === "TEXT"
                        ? `rounded-md border px-3 py-1.5 text-xs transition ${
                            selected
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
                          }`
                        : `flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 text-center transition ${
                            selected
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
                          }`
                    }
                  >
                    {designDisplayMode === "CLIPART" && (
                      <DesignOptionImage value={opt} overrideAttachmentId={optionReferenceImages[opt]} />
                    )}
                    <span className="text-xs leading-tight">{opt}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <StepNextButton step="PRODUCT_DESIGN" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 7 — Model */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.MODEL = el)}
        index={7}
        title="Model"
        isDone={project.completedSteps.includes("MODEL")}
        isCurrent={project.currentStep === "MODEL"}
        isOpen={expandedStep === "MODEL"}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Gender" htmlFor="modelGender">
            <select
              id="modelGender"
              className={textInputClass()}
              value={project.modelGender ?? ""}
              onChange={(e) => run("model", () => patchWizard({ modelGender: e.target.value }))}
            >
              <option value="">— Select —</option>
              {MODEL_GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Body Type" htmlFor="modelBodyType">
            <select
              id="modelBodyType"
              className={textInputClass()}
              value={project.modelBodyType ?? ""}
              onChange={(e) => run("model", () => patchWizard({ modelBodyType: e.target.value }))}
            >
              <option value="">— Select —</option>
              {BODY_TYPES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Pose" htmlFor="modelPose">
            <select
              id="modelPose"
              className={textInputClass()}
              value={project.modelPose ?? ""}
              onChange={(e) => run("model", () => patchWizard({ modelPose: e.target.value }))}
            >
              <option value="">— Select —</option>
              {POSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <StepNextButton step="MODEL" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 8 — Environment */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.ENVIRONMENT = el)}
        index={8}
        title="Environment"
        isDone={project.completedSteps.includes("ENVIRONMENT")}
        isCurrent={project.currentStep === "ENVIRONMENT"}
        isOpen={expandedStep === "ENVIRONMENT"}
      >
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
        <StepNextButton step="ENVIRONMENT" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 9 — Generate Design */}
      <WizardSection
        sectionRef={(el) => (sectionRefs.current.GENERATE = el)}
        index={9}
        title="Generate Design"
        isDone={project.completedSteps.includes("GENERATE")}
        isCurrent={project.currentStep === "GENERATE"}
        isOpen={expandedStep === "GENERATE"}
      >
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
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {generatedImages.map((img) => (
              <div key={img.id} className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(img.imageAttachmentId)} alt="Generated design" className="aspect-[3/4] w-full rounded object-cover" />
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={
                      img.decision === "SELECTED"
                        ? "text-green-600"
                        : img.decision === "REJECTED"
                          ? "text-red-600"
                          : "text-zinc-500"
                    }
                  >
                    {img.decision}
                  </span>
                  <div className="flex gap-2">
                    {img.decision !== "SELECTED" && (
                      <button type="button" className="text-indigo-600 hover:underline" onClick={() => setPendingSelectImage(img.id)}>
                        Select
                      </button>
                    )}
                    {img.decision !== "REJECTED" && (
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => run("reject", () => decideImageAction(img.id, "REJECT"))}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <StepNextButton step="GENERATE" onNext={goToNextStep} />
      </WizardSection>

      {/* Step 10 — Multi-Fabric */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.MULTI_FABRIC = el)}
          index={10}
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
          <StepNextButton step="MULTI_FABRIC" onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 11 — Embellishments */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.EMBELLISHMENTS = el)}
          index={11}
          title="Embellishments"
          isDone={project.completedSteps.includes("EMBELLISHMENTS")}
          isCurrent={project.currentStep === "EMBELLISHMENTS"}
          isOpen={expandedStep === "EMBELLISHMENTS"}
        >
          <p className="text-xs text-zinc-500">
            Optional. Add a digital applique or embroidery embellishment to the current design — upload a motif
            reference photo, describe how it should be applied, or both.
          </p>

          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Embellishment Type</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(EMBELLISHMENT_TYPE_LABELS).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={embellishmentType === type}
                  onClick={() => setEmbellishmentType(type)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    embellishmentType === type
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Embroidery / Applique Motif</p>
              <p className="mt-0.5 text-xs text-zinc-500">Upload a motif or embroidery pattern reference image (optional).</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-2 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  run("upload-embellishment-motif", () =>
                    fetch(`/api/v1/ai-designer/projects/${projectId}/embellishment-motif`, { method: "POST", body: formData }).then(parseJson)
                  );
                  e.target.value = "";
                }}
              />
              {project.embellishmentMotifAttachmentId && (
                <div className="mt-2 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imageUrl(project.embellishmentMotifAttachmentId)}
                    alt="Embellishment motif reference"
                    className="h-24 w-24 rounded border object-cover"
                  />
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() =>
                      run("delete-embellishment-motif", () =>
                        fetch(`/api/v1/ai-designer/projects/${projectId}/embellishment-motif`, { method: "DELETE" }).then(parseJson)
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">Embellishment Instructions</p>
              <textarea
                rows={4}
                className={textInputClass()}
                value={embellishmentInstructions}
                onChange={(e) => setEmbellishmentInstructions(e.target.value)}
                placeholder={
                  "e.g. \"Add intricate embroidery on the sleeves and neckline\", \"Apply sequins in a floral pattern on the bodice\", " +
                  "\"Add lace borders along the hem and cuffs\". Leave empty to use a sensible default."
                }
              />
              <button
                type="button"
                disabled={
                  busy === "apply-embellishments" ||
                  (!project.embellishmentMotifAttachmentId && !embellishmentInstructions.trim())
                }
                onClick={() =>
                  run("apply-embellishments", () =>
                    fetch(`/api/v1/ai-designer/projects/${projectId}/apply-embellishments`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ embellishmentType, instructions: embellishmentInstructions }),
                    }).then(parseJson)
                  )
                }
                className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy === "apply-embellishments" ? "Applying…" : "Apply Embellishments"}
              </button>
            </div>
          </div>
          <StepNextButton step="EMBELLISHMENTS" onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 12 — Edit Design */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.EDIT = el)}
          index={12}
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
          <StepNextButton step="EDIT" onNext={goToNextStep} />
        </WizardSection>
      )}

      {/* Step 13 — Tech Pack */}
      {currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.TECH_PACK = el)}
          index={13}
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

          <StepNextButton step="TECH_PACK" onNext={goToNextStep} />
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
          index={14}
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
          run("select", () => decideImageAction(pendingSelectImage!, "SELECT", true)).then(() => setPendingSelectImage(null))
        }
        onCancel={() => setPendingSelectImage(null)}
      />
    </div>
  );
}

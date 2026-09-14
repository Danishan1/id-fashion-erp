"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_BADGE_CLASS, STATUS_LABELS, STEP_LABELS, STEP_ORDER } from "../statusLabels";
import { ReferenceImageUploadPanel } from "./ReferenceImageUploadPanel";
import { DesignDnaReviewPanel } from "./DesignDnaReviewPanel";
import { FabricMaterialSelectionPanel } from "./FabricMaterialSelectionPanel";
import { CompatibilityWarningPanel } from "./CompatibilityWarningPanel";
import { GenerateResultPanel } from "./GenerateResultPanel";
import { TechPackPanel } from "./TechPackPanel";
import { imageUrl, parseJson } from "./shared";

interface Observation {
  id: string;
  featureKey: string;
  aiObservation: string;
  aiConfidence: string;
  approvedObservation: string;
  userEdited: boolean;
  isLocked: boolean;
}

interface DnaAnalysis {
  id: string;
  status: "DRAFT" | "AI_ANALYSED" | "UNDER_REVIEW" | "APPROVED" | "STALE";
  designDnaSummary: string | null;
  observations: Observation[];
}

interface MaterialLine {
  id: string;
  role: string;
  quantity: string | null;
  notes: string | null;
  product: { id: string; styleName: string; styleCode: string };
  uom: { id: string; name: string; code: string } | null;
}

interface CompatibilityItem {
  id: string;
  subjectType: "FABRIC" | "MATERIAL_LINE";
  aiRating: string;
  aiReasoning: string;
}

interface CompatibilityCheck {
  id: string;
  overallSummary: string | null;
  overallRating: string | null;
  items: CompatibilityItem[];
}

interface CurrentImage {
  id: string;
  imageAttachmentId: string;
}

interface ReplicateProjectData {
  id: string;
  projectNumber: string;
  projectName: string;
  status: keyof typeof STATUS_LABELS;
  currentStep: string;
  completedSteps: string[];
  referenceFrontImageAttachmentId: string | null;
  referenceBackImageAttachmentId: string | null;
  referenceSideImageAttachmentId: string | null;
  referenceDetailImageAttachmentId: string | null;
  fabricSource: "EXISTING" | "UPLOADED" | null;
  fabricProductId: string | null;
  fabricImageAttachmentId: string | null;
  fabricName: string | null;
  fabricCode: string | null;
  materialLines: MaterialLine[];
  dnaAnalysis: DnaAnalysis | null;
  compatibilityCheck: CompatibilityCheck | null;
  currentVersion: { currentImage: CurrentImage } | null;
}

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
            isDone ? "bg-green-600 text-white" : isCurrent ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
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

function StepNextButton({ step, onNext }: { step: string; onNext: (afterStep: string) => void }) {
  const idx = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
  const next = idx >= 0 ? STEP_ORDER[idx + 1] : undefined;
  if (!next) return null;
  return (
    <div className="mt-4 flex justify-end border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <button type="button" onClick={() => onNext(step)} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
        Next: {STEP_LABELS[next]} →
      </button>
    </div>
  );
}

export function ReplicateDesignWorkspace({ projectId, initialProject }: { projectId: string; initialProject: ReplicateProjectData }) {
  const [project, setProject] = useState(initialProject);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(initialProject.currentStep);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const jumpToStep = (step: string) => {
    setExpandedStep(step);
    requestAnimationFrame(() => sectionRefs.current[step]?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const goToNextStep = (afterStep: string) => {
    const idx = STEP_ORDER.indexOf(afterStep as (typeof STEP_ORDER)[number]);
    const next = idx >= 0 ? STEP_ORDER[idx + 1] : undefined;
    if (next) jumpToStep(next);
  };

  const reload = async () => {
    const body = await parseJson(await fetch(`/api/v1/ai-designer/replicate-projects/${projectId}`));
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

  const missingReasons: string[] = [];
  if (!project.referenceFrontImageAttachmentId) missingReasons.push("a front reference garment photo (Step 1)");
  if (!project.fabricImageAttachmentId) missingReasons.push("a real fabric/material reference photo (Step 4)");
  if (!project.dnaAnalysis || project.dnaAnalysis.status !== "APPROVED") missingReasons.push("an approved Design DNA analysis (Steps 2-3)");
  if (!project.compatibilityCheck) missingReasons.push("a compatibility check (Step 5)");
  const readyToGenerate = missingReasons.length === 0;

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "AI Designer", href: "/ai-designer" },
          { label: "Replicate Design", href: "/ai-designer/replicate" },
          { label: project.projectNumber },
        ]}
      />

      <div className="flex items-start justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {project.projectNumber} — {project.projectName}
        </h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[project.status]}`}>{STATUS_LABELS[project.status]}</span>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {STEP_ORDER.map((step, i) => {
          const done = project.completedSteps.includes(step);
          const current = project.currentStep === step;
          return (
            <button
              key={step}
              type="button"
              onClick={() => jumpToStep(step)}
              aria-current={current ? "step" : undefined}
              title={`Go to ${STEP_LABELS[step]}`}
              className={`rounded-full px-2 py-1 transition hover:opacity-80 ${
                done
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : current
                    ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-400 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {done ? "✓ " : `${i + 1}. `}
              {STEP_LABELS[step]}
            </button>
          );
        })}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.REFERENCE_UPLOAD = el)}
        index={1}
        title={STEP_LABELS.REFERENCE_UPLOAD}
        isDone={project.completedSteps.includes("REFERENCE_UPLOAD")}
        isCurrent={project.currentStep === "REFERENCE_UPLOAD"}
        isOpen={expandedStep === "REFERENCE_UPLOAD"}
      >
        <ReferenceImageUploadPanel projectId={projectId} project={project} busy={busy} run={run} />
        <StepNextButton step="REFERENCE_UPLOAD" onNext={goToNextStep} />
      </WizardSection>

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.DNA_ANALYSIS = el)}
        index={2}
        title={STEP_LABELS.DNA_ANALYSIS}
        isDone={project.completedSteps.includes("DNA_ANALYSIS")}
        isCurrent={project.currentStep === "DNA_ANALYSIS"}
        isOpen={expandedStep === "DNA_ANALYSIS"}
      >
        <DesignDnaReviewPanel
          projectId={projectId}
          hasReferenceImage={!!project.referenceFrontImageAttachmentId}
          analysis={project.dnaAnalysis}
          busy={busy}
          run={run}
        />
        <StepNextButton step="DNA_ANALYSIS" onNext={goToNextStep} />
      </WizardSection>

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.DESIGN_LOCK_REVIEW = el)}
        index={3}
        title={STEP_LABELS.DESIGN_LOCK_REVIEW}
        isDone={project.completedSteps.includes("DESIGN_LOCK_REVIEW")}
        isCurrent={project.currentStep === "DESIGN_LOCK_REVIEW"}
        isOpen={expandedStep === "DESIGN_LOCK_REVIEW"}
      >
        <p className="text-xs text-zinc-500">
          This is the same Design DNA review shown in Step 2 — toggle each feature&apos;s lock and click
          &quot;Approve Design DNA&quot; there once you&apos;re satisfied. Approving is what marks this step
          complete.
        </p>
        <DesignDnaReviewPanel
          projectId={projectId}
          hasReferenceImage={!!project.referenceFrontImageAttachmentId}
          analysis={project.dnaAnalysis}
          busy={busy}
          run={run}
        />
        <StepNextButton step="DESIGN_LOCK_REVIEW" onNext={goToNextStep} />
      </WizardSection>

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.FABRIC_MATERIAL_SELECTION = el)}
        index={4}
        title={STEP_LABELS.FABRIC_MATERIAL_SELECTION}
        isDone={project.completedSteps.includes("FABRIC_MATERIAL_SELECTION")}
        isCurrent={project.currentStep === "FABRIC_MATERIAL_SELECTION"}
        isOpen={expandedStep === "FABRIC_MATERIAL_SELECTION"}
      >
        <FabricMaterialSelectionPanel
          projectId={projectId}
          fabricProductId={project.fabricProductId}
          fabricImageAttachmentId={project.fabricImageAttachmentId}
          fabricName={project.fabricName}
          fabricCode={project.fabricCode}
          materialLines={project.materialLines}
          busy={busy}
          run={run}
        />
        <StepNextButton step="FABRIC_MATERIAL_SELECTION" onNext={goToNextStep} />
      </WizardSection>

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.COMPATIBILITY_CHECK = el)}
        index={5}
        title={STEP_LABELS.COMPATIBILITY_CHECK}
        isDone={project.completedSteps.includes("COMPATIBILITY_CHECK")}
        isCurrent={project.currentStep === "COMPATIBILITY_CHECK"}
        isOpen={expandedStep === "COMPATIBILITY_CHECK"}
      >
        <CompatibilityWarningPanel
          projectId={projectId}
          hasFabricOrMaterial={!!project.fabricName || project.materialLines.length > 0}
          hasApprovedDna={project.dnaAnalysis?.status === "APPROVED"}
          check={project.compatibilityCheck}
          busy={busy}
          run={run}
        />
        <StepNextButton step="COMPATIBILITY_CHECK" onNext={goToNextStep} />
      </WizardSection>

      <WizardSection
        sectionRef={(el) => (sectionRefs.current.GENERATE = el)}
        index={6}
        title={STEP_LABELS.GENERATE}
        isDone={project.completedSteps.includes("GENERATE")}
        isCurrent={project.currentStep === "GENERATE"}
        isOpen={expandedStep === "GENERATE"}
      >
        <GenerateResultPanel
          projectId={projectId}
          readyToGenerate={readyToGenerate}
          missingReasons={missingReasons}
          compatibilityCheck={project.compatibilityCheck}
          busy={busy}
          run={run}
        />
      </WizardSection>

      {project.currentVersion?.currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.EDIT = el)}
          index={7}
          title={STEP_LABELS.EDIT}
          isDone={project.completedSteps.includes("EDIT")}
          isCurrent={project.currentStep === "EDIT"}
          isOpen={expandedStep === "EDIT"}
        >
          <p className="text-xs text-zinc-500">
            A full single-page design workspace — canvas with zoom/pan, contextual edit categories, Quick/Technical/AI
            Prompt edit modes, AI variations review, before/after compare, and version history with Approve/Reject.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl(project.currentVersion.currentImage.imageAttachmentId)}
              alt="Current design"
              className="h-32 w-32 rounded border object-cover"
            />
            <Link
              href={`/ai-designer/replicate/${projectId}/edit`}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Open Design Editor →
            </Link>
          </div>
          <StepNextButton step="EDIT" onNext={goToNextStep} />
        </WizardSection>
      )}

      {project.currentVersion?.currentImage && (
        <WizardSection
          sectionRef={(el) => (sectionRefs.current.TECH_PACK = el)}
          index={8}
          title={STEP_LABELS.TECH_PACK}
          isDone={project.completedSteps.includes("TECH_PACK")}
          isCurrent={project.currentStep === "TECH_PACK"}
          isOpen={expandedStep === "TECH_PACK"}
        >
          <TechPackPanel projectId={projectId} hasCurrentDesign={!!project.currentVersion?.currentImage} busy={busy} run={run} />
        </WizardSection>
      )}
    </div>
  );
}

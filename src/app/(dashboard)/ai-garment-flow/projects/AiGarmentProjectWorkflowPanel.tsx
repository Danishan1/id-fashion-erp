"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { stepsForSourceType, type AiGarmentStepKey } from "@/modules/ai-garment-flow/ai-garment-project.schema";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../statusLabels";
import { AiGarmentProjectForm } from "./AiGarmentProjectForm";
import { ReferenceImageUploader } from "./ReferenceImageUploader";
import { ReferenceAnalysisPanel } from "./ReferenceAnalysisPanel";
import { DevelopmentBriefPanel } from "./DevelopmentBriefPanel";
import { VisualGenerationPanel } from "./VisualGenerationPanel";
import { CommercialEvaluationPanel } from "./CommercialEvaluationPanel";
import { FabricApplicationPanel } from "./FabricApplicationPanel";

const SAMPLE_TYPES = ["FIT", "PROTO", "PP", "TOP", "SHIPMENT", "PHOTOSHOOT", "SMS", "OTHER"] as const;

interface Option {
  id: string;
  name: string;
}

interface DesignOption {
  id: string;
  label: string | null;
  notes: string | null;
  isSelected: boolean;
}

type FabricDetail = {
  gsmId: string | null;
  dyeId: string | null;
  weaveTypeId: string | null;
  widthId: string | null;
  compositionId: string | null;
  colorId: string | null;
  supplierId: string | null;
  notes: string | null;
} | null;

interface Project {
  id: string;
  projectNumber: string;
  projectName: string;
  sourceType: "REFERENCE" | "FABRIC";
  status: keyof typeof STATUS_LABELS;
  statusBeforeHold: keyof typeof STATUS_LABELS | null;
  currentStepKey: AiGarmentStepKey;
  completedStepKeys: AiGarmentStepKey[];
  productId: string | null;
  sampleRequestId: string | null;
  referenceImageAttachmentId: string | null;
  product: { id: string; styleCode: string; styleName: string } | null;
  sampleRequest: { id: string; requestNumber: string; status: string } | null;
  designOptions: DesignOption[];
  fabricDetail: FabricDetail;
  notes: string | null;
  customerId: string | null;
  buyerId: string | null;
  brandId: string | null;
  seasonId: string | null;
  categoryId: string | null;
  targetMarket: string | null;
  targetCustomerProfile: string | null;
  targetSellingPrice: string | number | null;
  currencyCode: string | null;
  orderQuantityEstimate: string | number | null;
}

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  contextLabel: string | null;
  uploadedAt: string;
  uploadedBy: { fullName: string } | null;
}

const TERMINAL_STATUSES = ["COMPLETED", "REJECTED", "CANCELLED"];

const STEP_HELP: Partial<Record<AiGarmentStepKey, string>> = {
  PROJECT_INFO: "Confirm the project's basic details before moving on.",
  UPLOAD_REFERENCE: "Upload the reference photo, buyer image, or inspiration file this project is based on.",
  UPLOAD_FABRIC: "Upload a photo of the fabric swatch this project is based on.",
  REFERENCE_ANALYSIS: "AI would analyse the uploaded reference here once connected.",
  FABRIC_ANALYSIS: "AI would analyse the uploaded fabric here once connected.",
  DEVELOPMENT_BRIEF: "Generate differentiated commercial design directions from the approved reference analysis, then review, correct, and approve at least one to continue.",
  GENERATE_VARIATIONS: "Generate real garment visuals for each approved design direction, then Select, Reject, Regenerate, or Create a Variation of any image.",
  GENERATE_DESIGNS: "AI would generate design directions here once connected — add candidates manually for now.",
  PRODUCT_SUITABILITY: "AI would assess which garment types suit this fabric here once connected.",
  PRODUCT_DIRECTIONS: "AI would suggest concrete product directions here once connected.",
  COMMERCIAL_EVALUATION: "Select 2–8 approved design directions and compare them on a 12-criterion commercial rubric, then select the one to carry into development — a confirmed, user-approved choice.",
  SELECT_DESIGN: "Pick the one design candidate to carry forward.",
  APPLY_FABRIC:
    "Record which fabric master this design will use, then upload a real fabric swatch to see it applied onto the selected garment visual — approve a version, then APPROVE DESIGN & FABRIC to continue.",
  FABRIC_INFORMATION: "Record the fabric's GSM, dye/shade, weave, width, composition, color and supplier.",
  TECHNICAL_DEVELOPMENT: "Convert this project into a real Style once a design is settled, to continue into BOM and Costing.",
  BOM: "BOM is built on the graduated Style, using the existing BOM/MRP module.",
  COSTING: "Costing runs on a linked Sample Request, using Sampling's existing costing engine.",
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? "Request failed.");
  return json.data;
}

export function AiGarmentProjectWorkflowPanel({ projectId, initialProject }: { projectId: string; initialProject: Project }) {
  const [project, setProject] = useState<Project>(initialProject);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const steps = stepsForSourceType(project.sourceType);
  const currentIndex = steps.findIndex((s) => s.key === project.currentStepKey);
  const isTerminal = TERMINAL_STATUSES.includes(project.status);
  const isOnHold = project.status === "ON_HOLD";

  async function reloadProject() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}`);
    const body = await res.json();
    if (res.ok) setProject(body.data);
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveStep(stepKey: AiGarmentStepKey) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/workflow-step`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save step.");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    const next = steps[currentIndex + 1];
    if (next) void saveStep(next.key);
  }
  function goBack() {
    const prev = steps[currentIndex - 1];
    if (prev) void saveStep(prev.key);
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[project.status]}`}>
            {STATUS_LABELS[project.status] ?? project.status}
          </span>
          {isOnHold && project.statusBeforeHold && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">On hold from {STATUS_LABELS[project.statusBeforeHold]}</span>
          )}
        </div>
        <div className="flex gap-2">
          {!isTerminal && !isOnHold && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => postJson(`/api/v1/ai-garment-projects/${projectId}/hold`))}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Put On Hold
            </button>
          )}
          {isOnHold && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => postJson(`/api/v1/ai-garment-projects/${projectId}/resume`))}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Resume
            </button>
          )}
          {!isTerminal && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => postJson(`/api/v1/ai-garment-projects/${projectId}/cancel`))}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Cancel Project
            </button>
          )}
        </div>
      </div>

      {/* Progress stepper */}
      <ol className="flex flex-wrap gap-2">
        {steps.map((step, idx) => {
          const isDone = project.completedStepKeys.includes(step.key);
          const isCurrent = step.key === project.currentStepKey;
          return (
            <li key={step.key}>
              <button
                type="button"
                disabled={isTerminal || isOnHold}
                onClick={() => void saveStep(step.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                  isCurrent
                    ? "border-indigo-500 bg-indigo-600 text-white"
                    : isDone
                      ? "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-500/10 dark:text-green-300"
                      : "border-zinc-300 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                {idx + 1}. {step.label}
              </button>
            </li>
          );
        })}
      </ol>

      {(isTerminal || isOnHold) ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {isOnHold ? "Resume this project to continue its workflow." : `This project is ${STATUS_LABELS[project.status]} and its workflow is closed.`}
        </p>
      ) : (
        <StepContent
          project={project}
          onGoNext={goNext}
          onGoBack={goBack}
          canGoBack={currentIndex > 0}
          canGoNext={currentIndex < steps.length - 1}
          busy={busy}
          setError={setError}
          reloadProject={reloadProject}
        />
      )}
    </div>
  );
}

function StepContent({
  project,
  onGoNext,
  onGoBack,
  canGoBack,
  canGoNext,
  busy,
  setError,
  reloadProject,
}: {
  project: Project;
  onGoNext: () => void;
  onGoBack: () => void;
  canGoBack: boolean;
  canGoNext: boolean;
  busy: boolean;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const key = project.currentStepKey;

  const NavButtons = (
    <div className="flex justify-between pt-2">
      <button
        type="button"
        disabled={!canGoBack || busy}
        onClick={onGoBack}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Back
      </button>
      <button
        type="button"
        disabled={!canGoNext || busy}
        onClick={onGoNext}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
      >
        {key === "DEVELOPMENT_BRIEF" ? "APPROVE DESIGN DIRECTIONS" : "Save & Continue"}
      </button>
    </div>
  );

  const wrap = (children: React.ReactNode) => (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {STEP_HELP[key] && <p className="text-sm text-zinc-500 dark:text-zinc-400">{STEP_HELP[key]}</p>}
      {children}
      {NavButtons}
    </div>
  );

  if (key === "PROJECT_INFO") {
    return wrap(
      <AiGarmentProjectForm
        sourceType={project.sourceType}
        projectId={project.id}
        initialValues={{
          projectName: project.projectName,
          customerId: project.customerId ?? "",
          buyerId: project.buyerId ?? "",
          brandId: project.brandId ?? "",
          seasonId: project.seasonId ?? "",
          categoryId: project.categoryId ?? "",
          targetMarket: project.targetMarket ?? "",
          targetCustomerProfile: project.targetCustomerProfile ?? "",
          targetSellingPrice: project.targetSellingPrice != null ? String(project.targetSellingPrice) : "",
          currencyCode: project.currencyCode ?? "",
          orderQuantityEstimate: project.orderQuantityEstimate != null ? String(project.orderQuantityEstimate) : "",
          notes: project.notes ?? "",
        }}
        onSaved={() => void reloadProject()}
      />
    );
  }

  if (key === "UPLOAD_FABRIC") {
    return wrap(<UploadStep projectId={project.id} assetType="FABRIC_SWATCH" setError={setError} />);
  }

  if (key === "UPLOAD_REFERENCE") {
    return wrap(<ReferenceImageUploader projectId={project.id} onChanged={() => void reloadProject()} />);
  }

  if (key === "REFERENCE_ANALYSIS") {
    return wrap(<ReferenceAnalysisPanel projectId={project.id} hasReferenceImage={Boolean(project.referenceImageAttachmentId)} />);
  }

  if (key === "DEVELOPMENT_BRIEF") {
    return wrap(
      <DevelopmentBriefPanel
        projectId={project.id}
        project={{
          targetMarket: project.targetMarket,
          targetCustomerProfile: project.targetCustomerProfile,
          seasonId: project.seasonId,
          categoryId: project.categoryId,
          targetSellingPrice: project.targetSellingPrice,
          currencyCode: project.currencyCode,
          buyerId: project.buyerId,
          customerId: project.customerId,
        }}
      />
    );
  }

  if (["FABRIC_ANALYSIS", "PRODUCT_SUITABILITY", "PRODUCT_DIRECTIONS"].includes(key)) {
    return wrap(<AiPlaceholderButton label={aiButtonLabel(key)} />);
  }

  if (key === "GENERATE_VARIATIONS") {
    return wrap(<VisualGenerationPanel projectId={project.id} />);
  }

  if (key === "GENERATE_DESIGNS") {
    return wrap(
      <>
        <AiPlaceholderButton label="Generate Designs" />
        <DesignOptionsSection project={project} setError={setError} reloadProject={reloadProject} allowAdd allowSelect={false} />
      </>
    );
  }

  if (key === "COMMERCIAL_EVALUATION") {
    return wrap(<CommercialEvaluationPanel projectId={project.id} setError={setError} reloadProject={reloadProject} />);
  }

  if (key === "SELECT_DESIGN") {
    return wrap(<DesignOptionsSection project={project} setError={setError} reloadProject={reloadProject} allowAdd={false} allowSelect />);
  }

  if (key === "APPLY_FABRIC" || key === "FABRIC_INFORMATION") {
    return wrap(
      <>
        <FabricDetailForm project={project} setError={setError} reloadProject={reloadProject} />
        {key === "APPLY_FABRIC" && (
          <div className="mt-4">
            <FabricApplicationPanel projectId={project.id} setError={setError} reloadProject={reloadProject} />
          </div>
        )}
      </>
    );
  }

  if (key === "TECHNICAL_DEVELOPMENT") {
    return wrap(
      <>
        <ConvertToStyleSection project={project} setError={setError} reloadProject={reloadProject} />
        <AiPlaceholderButton label="Create Technical Flat" />
      </>
    );
  }

  if (key === "BOM") {
    return wrap(
      project.productId ? (
        <Link
          href={`/bom-mrp/${project.productId}`}
          className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Open BOM Editor for {project.product?.styleCode}
        </Link>
      ) : (
        <p className="text-sm text-amber-700 dark:text-amber-400">Convert this project to a Style first (Technical Development step).</p>
      )
    );
  }

  if (key === "COSTING") {
    return wrap(
      <>
        <CostingSection project={project} setError={setError} reloadProject={reloadProject} />
        <AiPlaceholderButton label="Analyse Cost" />
      </>
    );
  }

  return wrap(null);
}

function aiButtonLabel(key: AiGarmentStepKey): string {
  switch (key) {
    case "REFERENCE_ANALYSIS":
    case "FABRIC_ANALYSIS":
      return "Analyse with AI";
    case "DEVELOPMENT_BRIEF":
      return "Create Development Brief";
    case "PRODUCT_SUITABILITY":
      return "Assess Product Suitability";
    case "PRODUCT_DIRECTIONS":
      return "Suggest Product Directions";
    default:
      return "Analyse with AI";
  }
}

function AiPlaceholderButton({ label }: { label: string }) {
  const [clicked, setClicked] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setClicked(true)}
        className="rounded-md border border-dashed border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        {label}
      </button>
      {clicked && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">AI integration not connected.</p>}
    </div>
  );
}

function UploadStep({ projectId, assetType, setError }: { projectId: string; assetType: string; setError: (e: string | null) => void }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/attachments`);
    const body = await res.json();
    if (res.ok) setAttachments(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/attachments`)
      .then((res) => res.json())
      .then((body) => setAttachments(body.data ?? []));
  }, [projectId]);

  async function upload() {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("assetType", assetType);
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/attachments`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Upload failed.");
      setFile(null);
      setInputKey((k) => k + 1);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const relevant = attachments.filter((a) => a.contextLabel === assetType);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input key={inputKey} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        <button
          type="button"
          disabled={!file || uploading}
          onClick={upload}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {relevant.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No files uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {relevant.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setPreview(a)}>
                {a.fileName}
              </button>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {a.uploadedBy?.fullName} · {new Date(a.uploadedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <FilePreviewModal
          key={preview.id}
          open
          onClose={() => setPreview(null)}
          previewUrl={`/api/v1/ai-garment-projects/attachments/${preview.id}/download?disposition=inline`}
          downloadUrl={`/api/v1/ai-garment-projects/attachments/${preview.id}/download`}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
        />
      )}
    </div>
  );
}

function DesignOptionsSection({
  project,
  setError,
  reloadProject,
  allowAdd,
  allowSelect,
}: {
  project: Project;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
  allowAdd: boolean;
  allowSelect: boolean;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function addOption() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${project.id}/design-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || undefined, notes: notes || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to add design option.");
      setLabel("");
      setNotes("");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function select(optionId: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-options/${optionId}/select`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to select design.");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {allowAdd && (
        <div className="flex flex-wrap items-end gap-2">
          <FormField label="Label" htmlFor="designLabel">
            <input id="designLabel" className={textInputClass()} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Variation 1" />
          </FormField>
          <FormField label="Notes" htmlFor="designNotes">
            <input id="designNotes" className={textInputClass()} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
          <button
            type="button"
            disabled={busy}
            onClick={addOption}
            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Add Candidate
          </button>
        </div>
      )}

      {project.designOptions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No design candidates yet.</p>
      ) : (
        <ul className="space-y-2">
          {project.designOptions.map((opt) => (
            <li
              key={opt.id}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                opt.isSelected ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-500/10" : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-50">{opt.label || "Untitled candidate"}</p>
                {opt.notes && <p className="text-xs text-zinc-500 dark:text-zinc-400">{opt.notes}</p>}
              </div>
              {allowSelect &&
                (opt.isSelected ? (
                  <span className="text-xs font-medium text-green-700 dark:text-green-300">Selected</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => select(opt.id)}
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Select
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FabricDetailForm({
  project,
  setError,
  reloadProject,
}: {
  project: Project;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const existing = project.fabricDetail;
  const [gsmId, setGsmId] = useState(existing?.gsmId ?? "");
  const [dyeId, setDyeId] = useState(existing?.dyeId ?? "");
  const [weaveTypeId, setWeaveTypeId] = useState(existing?.weaveTypeId ?? "");
  const [widthId, setWidthId] = useState(existing?.widthId ?? "");
  const [compositionId, setCompositionId] = useState(existing?.compositionId ?? "");
  const [colorId, setColorId] = useState(existing?.colorId ?? "");
  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const [gsms, setGsms] = useState<Option[]>([]);
  const [dyes, setDyes] = useState<Option[]>([]);
  const [weaveTypes, setWeaveTypes] = useState<Option[]>([]);
  const [widths, setWidths] = useState<Option[]>([]);
  const [compositions, setCompositions] = useState<Option[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/v1/fabric-gsms").then((r) => r.json()).then((b) => setGsms(b.data ?? []));
    fetch("/api/v1/fabric-dyes").then((r) => r.json()).then((b) => setDyes(b.data ?? []));
    fetch("/api/v1/fabric-weave-types").then((r) => r.json()).then((b) => setWeaveTypes(b.data ?? []));
    fetch("/api/v1/fabric-widths").then((r) => r.json()).then((b) => setWidths(b.data ?? []));
    fetch("/api/v1/fabric-compositions").then((r) => r.json()).then((b) => setCompositions(b.data ?? []));
    fetch("/api/v1/colors").then((r) => r.json()).then((b) => setColors(b.data ?? []));
    fetch("/api/v1/suppliers?pageSize=200").then((r) => r.json()).then((b) => setSuppliers(b.data ?? []));
  }, []);

  async function save() {
    setError(null);
    setBusy(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${project.id}/fabric-detail`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gsmId: gsmId || undefined,
          dyeId: dyeId || undefined,
          weaveTypeId: weaveTypeId || undefined,
          widthId: widthId || undefined,
          compositionId: compositionId || undefined,
          colorId: colorId || undefined,
          supplierId: supplierId || undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save fabric detail.");
      await reloadProject();
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const select = (label: string, value: string, setValue: (v: string) => void, options: Option[]) => (
    <FormField label={label} htmlFor={`fabric-${label}`}>
      <select id={`fabric-${label}`} className={textInputClass()} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    </FormField>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {select("GSM", gsmId, setGsmId, gsms)}
        {select("Dye / Shade", dyeId, setDyeId, dyes)}
        {select("Weave Type", weaveTypeId, setWeaveTypeId, weaveTypes)}
        {select("Width", widthId, setWidthId, widths)}
        {select("Composition", compositionId, setCompositionId, compositions)}
        {select("Color", colorId, setColorId, colors)}
        {select("Supplier", supplierId, setSupplierId, suppliers)}
      </div>
      <FormField label="Notes" htmlFor="fabricNotes">
        <textarea id="fabricNotes" rows={2} className={textInputClass()} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save Fabric Detail"}
        </button>
        {saved && <span className="text-xs text-green-700 dark:text-green-300">Saved.</span>}
      </div>
    </div>
  );
}

function ConvertToStyleSection({
  project,
  setError,
  reloadProject,
}: {
  project: Project;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [styleCode, setStyleCode] = useState("");
  const [styleName, setStyleName] = useState(project.projectName);
  const [busy, setBusy] = useState(false);

  if (project.productId) {
    return (
      <p className="text-sm text-green-700 dark:text-green-300">
        Linked to Style{" "}
        <Link href={`/masters/products/${project.productId}`} className="font-medium underline">
          {project.product?.styleCode}
        </Link>
        .
      </p>
    );
  }

  async function convert() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${project.id}/convert-to-style`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleCode, styleName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to convert to Style.");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Convert to Style</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Style Code" htmlFor="styleCode" required>
          <input id="styleCode" className={textInputClass()} value={styleCode} onChange={(e) => setStyleCode(e.target.value)} />
        </FormField>
        <FormField label="Style Name" htmlFor="styleName" required>
          <input id="styleName" className={textInputClass()} value={styleName} onChange={(e) => setStyleName(e.target.value)} />
        </FormField>
      </div>
      <button
        type="button"
        disabled={busy || !styleCode || !styleName}
        onClick={convert}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "Converting…" : "Convert to Style"}
      </button>
    </div>
  );
}

function CostingSection({
  project,
  setError,
  reloadProject,
}: {
  project: Project;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [sampleType, setSampleType] = useState<(typeof SAMPLE_TYPES)[number]>("PP");
  const [busy, setBusy] = useState(false);

  if (project.sampleRequestId) {
    return (
      <p className="text-sm text-green-700 dark:text-green-300">
        Linked to Sample Request{" "}
        <Link href={`/sampling/${project.sampleRequestId}`} className="font-medium underline">
          {project.sampleRequest?.requestNumber}
        </Link>
        .
      </p>
    );
  }

  if (!project.productId) {
    return <p className="text-sm text-amber-700 dark:text-amber-400">Convert this project to a Style first (Technical Development step).</p>;
  }

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${project.id}/create-sample-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create Sample Request.");
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Create Sample Request</p>
      <FormField label="Sample Type" htmlFor="sampleType">
        <select id="sampleType" className={textInputClass()} value={sampleType} onChange={(e) => setSampleType(e.target.value as (typeof SAMPLE_TYPES)[number])}>
          {SAMPLE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </FormField>
      <button
        type="button"
        disabled={busy}
        onClick={create}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create Sample Request"}
      </button>
    </div>
  );
}

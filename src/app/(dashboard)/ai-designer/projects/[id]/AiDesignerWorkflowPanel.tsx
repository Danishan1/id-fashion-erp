"use client";

import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
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
import { getDesignAttributesForCategory } from "@/core/ai-designer/catalogs/design-attribute-catalog";
import { ENVIRONMENTS } from "@/core/ai-designer/catalogs/environment-catalog";
import { BODY_TYPES, MODEL_GENDERS, POSES } from "@/core/ai-designer/catalogs/model-catalog";
import { FABRIC_FIELD_KEYS, type FabricFieldKey } from "@/modules/ai-designer/ai-designer.schema";
import { STATUS_BADGE_CLASS, STATUS_LABELS, WIZARD_STEP_LABELS, WIZARD_STEP_ORDER } from "../../statusLabels";

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
  currentVersion: { currentImage: AiDesignerImageRow } | null;
  versions: { versionNumber: number; changeSummary: string | null; currentImage: AiDesignerImageRow }[];
  fabricProduct: { id: string; styleName: string; styleCode: string } | null;
}

function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

export function AiDesignerWorkflowPanel({ projectId, initialProject }: { projectId: string; initialProject: AiDesignerProjectData }) {
  const [project, setProject] = useState(initialProject);
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editFeature, setEditFeature] = useState("");
  const [editCurrent, setEditCurrent] = useState("");
  const [editNew, setEditNew] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [pendingSelectImage, setPendingSelectImage] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<AiDesignerImageRow[]>([]);

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
  const designAttributes = useMemo(() => getDesignAttributesForCategory(project.productCategory ?? ""), [project.productCategory]);
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

      {/* Progress stepper */}
      <div className="flex flex-wrap gap-2 text-xs">
        {WIZARD_STEP_ORDER.map((step) => {
          const done = project.completedSteps.includes(step);
          const current = project.currentStep === step;
          return (
            <span
              key={step}
              className={`rounded-full px-2 py-1 ${
                done
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : current
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {done ? "✓ " : ""}
              {WIZARD_STEP_LABELS[step]}
            </span>
          );
        })}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>}

      {/* Step 1 — Fabric Selection */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 1 — Fabric Selection</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
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
      </section>

      {/* Step 2 — Analyze Fabric with AI */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 2 — Analyze Fabric with AI</h2>
        <p className="mt-1 text-xs text-zinc-500">Fabric Name, Composition, GSM, Width, Weave, Stretch, Opacity, Texture, Pattern Type, Print Type, Suitable Season, Recommended Garments.</p>
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
      </section>

      {/* Step 3 — Target Customer */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 3 — Target Customer</h2>
        <div className="mt-2 flex flex-wrap gap-2">
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
      </section>

      {/* Step 4 — Age Group */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 4 — Age Group</h2>
        {!project.targetCustomer && <p className="mt-1 text-xs text-zinc-500">Pick a Target Customer first.</p>}
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
      </section>

      {/* Step 5 — Product Category */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 5 — Product Category</h2>
        {!project.targetCustomer && <p className="mt-1 text-xs text-zinc-500">Pick a Target Customer first.</p>}
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
      </section>

      {/* Step 6 — Product Design */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 6 — Product Design</h2>
        {!project.productCategory && <p className="mt-1 text-xs text-zinc-500">Pick a Product Category first.</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {designAttributes.map((attr) => (
            <FormField key={attr.key} label={attr.label} htmlFor={attr.key}>
              <select
                id={attr.key}
                className={textInputClass()}
                value={designSelections[attr.key] ?? ""}
                onChange={(e) => run("design", () => patchWizard({ designSelections: { [attr.key]: e.target.value } }))}
              >
                <option value="">— Select —</option>
                {attr.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </FormField>
          ))}
        </div>
      </section>

      {/* Step 7 — Model */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 7 — Model</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
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
      </section>

      {/* Step 8 — Environment */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 8 — Environment</h2>
        <div className="mt-2 flex flex-wrap gap-2">
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
      </section>

      {/* Step 9 — Generate Design */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 9 — Generate Design</h2>
        <div className="mt-2 flex gap-2">
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
      </section>

      {/* Step 10 — Edit Design */}
      {currentImage && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 10 — Edit Design</h2>
          <p className="mt-1 text-xs text-zinc-500">Change one aspect of the current design (Collar, Sleeves, Length, Pocket, Buttons, Logo, Embroidery, Color, Background, Environment, Model, Pose) — only the affected area is regenerated.</p>
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(currentImage.imageAttachmentId)} alt="Current design" className="h-32 w-32 rounded border object-cover" />
            <button
              type="button"
              onClick={() => {
                setEditFeature("");
                setEditCurrent("");
                setEditNew("");
                setEditInstructions("");
                setEditModalOpen(true);
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700"
            >
              Edit Design
            </button>
          </div>
        </section>
      )}

      {/* Step 11 — Versions */}
      {project.versions.length > 0 && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Version History</h2>
          <div className="mt-3 space-y-2">
            {project.versions.map((v) => (
              <div key={v.versionNumber} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 font-medium">v{v.versionNumber}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(v.currentImage.imageAttachmentId)} alt={`Version ${v.versionNumber}`} className="h-10 w-10 rounded border object-cover" />
                <span className="text-zinc-500">{v.changeSummary}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step 12 — Export */}
      {currentImage && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Step 12 — Export</h2>
          <div className="mt-2 flex gap-2">
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
        </section>
      )}

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Design">
        <div className="space-y-3">
          <FormField label="Feature to Change" htmlFor="editFeature" required>
            <input id="editFeature" className={textInputClass()} value={editFeature} onChange={(e) => setEditFeature(e.target.value)} placeholder="e.g. Collar" />
          </FormField>
          <FormField label="Current Value" htmlFor="editCurrent">
            <input id="editCurrent" className={textInputClass()} value={editCurrent} onChange={(e) => setEditCurrent(e.target.value)} placeholder="e.g. Round Neck" />
          </FormField>
          <FormField label="New Requirement" htmlFor="editNew" required>
            <input id="editNew" className={textInputClass()} value={editNew} onChange={(e) => setEditNew(e.target.value)} placeholder="e.g. Mandarin Collar" />
          </FormField>
          <FormField label="Additional Instructions (optional)" htmlFor="editInstructions">
            <textarea
              id="editInstructions"
              className={textInputClass()}
              rows={2}
              value={editInstructions}
              onChange={(e) => setEditInstructions(e.target.value)}
            />
          </FormField>
          <button
            type="button"
            disabled={busy === "edit" || !editFeature.trim() || !editNew.trim()}
            onClick={() =>
              run("edit", async () => {
                const body = await parseJson(
                  await fetch(`/api/v1/ai-designer/projects/${projectId}/edit`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      featureLabel: editFeature,
                      currentValue: editCurrent,
                      newValue: editNew,
                      additionalInstructions: editInstructions,
                    }),
                  })
                );
                setGeneratedImages((prev) => [...prev, ...body.data.images]);
                setEditModalOpen(false);
              })
            }
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "edit" ? "Regenerating…" : "Regenerate Affected Area"}
          </button>
        </div>
      </Modal>

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

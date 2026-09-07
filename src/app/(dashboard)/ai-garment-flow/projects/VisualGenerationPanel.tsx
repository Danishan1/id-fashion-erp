"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FilePreviewModal } from "@/components/ui/FilePreviewModal";
import { Modal } from "@/components/ui/Modal";
import { DESIGN_FEATURE_VALUES, DESIGN_FEATURE_LABELS, type DesignFeature } from "@/core/ai/design-variation/feature-registry";

const IMAGE_COUNT_OPTIONS = [1, 3, 4] as const;

interface ApprovedDirection {
  id: string;
  designDirectionName: string;
  overallScore: number;
  commercialRationale: string;
}

interface GeneratedImage {
  id: string;
  designDirectionId: string;
  generationRunId: string;
  imageAttachmentId: string;
  provider: string;
  model: string;
  promptVersion: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  userNotes: string | null;
  createdAt: string;
  generationRun: { id: string; parentGeneratedImageId: string | null; requestedImageCount: number };
}

interface DesignVariation {
  id: string;
  parentGeneratedImageId: string;
  variationNumber: number;
  featureKey: DesignFeature;
  previousValue: string;
  newValue: string;
  additionalInstructions: string | null;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "KEPT_ORIGINAL";
  createdAt: string;
}

function imageUrl(attachmentId: string): string {
  return `/api/v1/ai-garment-projects/attachments/${attachmentId}/download?disposition=inline`;
}

export function VisualGenerationPanel({ projectId }: { projectId: string }) {
  const [directions, setDirections] = useState<ApprovedDirection[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/development-brief/directions`)
      .then((res) => res.json())
      .then((body) => {
        const approved = (body.data ?? []).filter((d: { status: string }) => d.status === "APPROVED");
        setDirections(approved);
      });
  }, [projectId]);

  if (directions === undefined) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}

      {directions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No design directions are approved yet — approve at least one on the Development Brief step to generate visuals for it here.
        </p>
      ) : (
        directions.map((direction) => (
          <DirectionVisualsSection key={direction.id} direction={direction} setError={setError} />
        ))
      )}
    </div>
  );
}

function DirectionVisualsSection({
  direction,
  setError,
}: {
  direction: ApprovedDirection;
  setError: (e: string | null) => void;
}) {
  const [images, setImages] = useState<GeneratedImage[] | undefined>(undefined);
  const [imageCount, setImageCount] = useState<(typeof IMAGE_COUNT_OPTIONS)[number]>(1);
  const [generating, setGenerating] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}/generated-images`);
    const body = await res.json();
    if (res.ok) setImages(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}/generated-images`)
      .then((res) => res.json())
      .then((body) => setImages(body.data ?? []));
  }, [direction.id]);

  async function generate(count: number) {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${direction.id}/generated-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount: count }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to generate visuals.");
      setImages(body.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function toggleCompare(imageId: string) {
    setCompareSelection((prev) => (prev.includes(imageId) ? prev.filter((id) => id !== imageId) : [...prev, imageId]));
  }

  const compareImages = images?.filter((img) => compareSelection.includes(img.id)) ?? [];

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{direction.designDirectionName}</h4>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">{direction.commercialRationale}</p>
        </div>
        <span className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {direction.overallScore}/100
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <select
          value={imageCount}
          onChange={(e) => setImageCount(Number(e.target.value) as (typeof IMAGE_COUNT_OPTIONS)[number])}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          {IMAGE_COUNT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n} visual{n === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={generating}
          onClick={() => generate(imageCount)}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Generating…" : "GENERATE VISUAL"}
        </button>
        {images && images.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setCompareMode((m) => !m);
              setCompareSelection([]);
            }}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {compareMode ? "Exit Compare" : "Compare"}
          </button>
        )}
      </div>

      {compareMode && compareImages.length > 0 && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-500/10">
          <p className="mb-2 text-xs font-medium text-indigo-700 dark:text-indigo-300">Comparing {compareImages.length} image(s)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {compareImages.map((img) => (
              <img key={img.id} src={imageUrl(img.imageAttachmentId)} alt="Comparison" className="w-full rounded-md border border-zinc-200 dark:border-zinc-700" />
            ))}
          </div>
        </div>
      )}

      {images === undefined ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading images…</p>
      ) : images.length === 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">No visuals generated yet for this design direction.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((img) => (
            <GeneratedImageThumb
              key={img.id}
              image={img}
              compareMode={compareMode}
              compareChecked={compareSelection.includes(img.id)}
              onToggleCompare={() => toggleCompare(img.id)}
              onChanged={load}
              setError={setError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GeneratedImageThumb({
  image,
  compareMode,
  compareChecked,
  onToggleCompare,
  onChanged,
  setError,
}: {
  image: GeneratedImage;
  compareMode: boolean;
  compareChecked: boolean;
  onToggleCompare: () => void;
  onChanged: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmSelectOpen, setConfirmSelectOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState(image.userNotes ?? "");
  const [modifyOpen, setModifyOpen] = useState(false);
  const [variationsOpen, setVariationsOpen] = useState(false);
  const [variations, setVariations] = useState<DesignVariation[] | undefined>(undefined);

  const DECISION_BADGE: Record<GeneratedImage["decision"], string> = {
    PENDING: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    SELECTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
    REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
  };

  async function reject() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${image.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECT" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to reject this image.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmSelect() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${image.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "SELECT", confirmed: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to select this image.");
      setConfirmSelectOpen(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-directions/${image.designDirectionId}/generated-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount: 1 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to regenerate.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createVariation() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${image.id}/create-variation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount: 1 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to create a variation.");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function loadVariations() {
    const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${image.id}/design-variations`);
    const body = await res.json();
    if (res.ok) setVariations(body.data ?? []);
  }

  function toggleVariations() {
    setVariationsOpen((open) => {
      const next = !open;
      if (next && variations === undefined) void loadVariations();
      return next;
    });
  }

  async function decideVariation(variationId: string, decision: "SELECT" | "KEEP_ORIGINAL") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/design-variations/${variationId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision === "SELECT" ? { decision, confirmed: true } : { decision }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to update this variation.");
      await loadVariations();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${image.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userNotes: notesDraft }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save notes.");
      setEditingNotes(false);
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="relative">
        {compareMode && (
          <input
            type="checkbox"
            checked={compareChecked}
            onChange={onToggleCompare}
            className="absolute left-1 top-1 h-4 w-4"
            aria-label="Select for comparison"
          />
        )}
        <img
          src={imageUrl(image.imageAttachmentId)}
          alt="Generated design"
          className="w-full cursor-zoom-in rounded border border-zinc-200 dark:border-zinc-700"
          onClick={() => setPreview(true)}
        />
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${DECISION_BADGE[image.decision]}`}>{image.decision}</span>
        {image.generationRun.parentGeneratedImageId && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500" title="Created as a variation of another image">
            Variation
          </span>
        )}
      </div>

      {editingNotes ? (
        <div className="space-y-1">
          <textarea
            rows={2}
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex gap-1">
            <button type="button" disabled={busy} onClick={saveNotes} className="rounded bg-indigo-600 px-2 py-0.5 text-[10px] text-white">
              Save
            </button>
            <button type="button" onClick={() => setEditingNotes(false)} className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] dark:border-zinc-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setEditingNotes(true)} className="block w-full truncate text-left text-[11px] text-zinc-500 hover:underline dark:text-zinc-400">
          {image.userNotes || "Add notes…"}
        </button>
      )}

      <div className="flex flex-wrap gap-1 pt-1">
        <button
          type="button"
          disabled={busy || image.decision === "SELECTED"}
          onClick={() => setConfirmSelectOpen(true)}
          className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          Select
        </button>
        <button
          type="button"
          disabled={busy || image.decision === "REJECTED"}
          onClick={reject}
          className="rounded border border-red-300 px-1.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-500/10"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={regenerate}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Regenerate
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={createVariation}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Create Variation
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setModifyOpen(true)}
          className="rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-purple-500 disabled:opacity-50"
        >
          MODIFY DESIGN
        </button>
      </div>

      <button
        type="button"
        onClick={toggleVariations}
        className="block w-full text-left text-[10px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
      >
        {variationsOpen ? "Hide" : "Show"} design variations{variations ? ` (${variations.length})` : ""}
      </button>

      {variationsOpen && (
        <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/50">
          {variations === undefined ? (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : variations.length === 0 ? (
            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">No design variations yet — use MODIFY DESIGN above.</p>
          ) : (
            variations.map((v) => (
              <DesignVariationRow
                key={v.id}
                originalImage={image}
                variation={v}
                busy={busy}
                onSelect={() => decideVariation(v.id, "SELECT")}
                onKeepOriginal={() => decideVariation(v.id, "KEEP_ORIGINAL")}
                onCreateAnother={() => setModifyOpen(true)}
              />
            ))
          )}
        </div>
      )}

      <DesignVariationModifyForm
        open={modifyOpen}
        parentImageId={image.id}
        onClose={() => setModifyOpen(false)}
        onCreated={async () => {
          setModifyOpen(false);
          setVariationsOpen(true);
          await loadVariations();
        }}
        setError={setError}
      />

      <ConfirmModal
        open={confirmSelectOpen}
        title="Select as final design?"
        message="This marks this generated visual as the selected design for this design direction. You can change your selection later, but this action needs your confirmation."
        confirmLabel="Select This Design"
        isBusy={busy}
        onConfirm={confirmSelect}
        onCancel={() => setConfirmSelectOpen(false)}
      />

      {preview && (
        <FilePreviewModal
          key={image.id}
          open={preview}
          onClose={() => setPreview(false)}
          previewUrl={imageUrl(image.imageAttachmentId)}
          downloadUrl={`/api/v1/ai-garment-projects/attachments/${image.imageAttachmentId}/download`}
          fileName={`${image.id}.png`}
          mimeType="image/png"
        />
      )}
    </div>
  );
}

const VARIATION_DECISION_BADGE: Record<DesignVariation["decision"], string> = {
  PENDING: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  SELECTED: "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  KEPT_ORIGINAL: "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
};

/** Original / Variation side by side, per the spec — the original image is never touched by any action here. */
function DesignVariationRow({
  originalImage,
  variation,
  busy,
  onSelect,
  onKeepOriginal,
  onCreateAnother,
}: {
  originalImage: GeneratedImage;
  variation: DesignVariation;
  busy: boolean;
  onSelect: () => void;
  onKeepOriginal: () => void;
  onCreateAnother: () => void;
}) {
  const [confirmSelectOpen, setConfirmSelectOpen] = useState(false);

  return (
    <div className="space-y-1.5 rounded border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">Original</p>
          <img src={imageUrl(originalImage.imageAttachmentId)} alt="Original design" className="w-full rounded border border-zinc-200 dark:border-zinc-700" />
        </div>
        <div>
          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-400">Variation {variation.variationNumber}</p>
          <img src={imageUrl(variation.imageAttachmentId)} alt={`Variation ${variation.variationNumber}`} className="w-full rounded border border-zinc-200 dark:border-zinc-700" />
        </div>
      </div>

      <div className="space-y-0.5 text-[10px] text-zinc-600 dark:text-zinc-300">
        <p>
          <span className="font-medium">{DESIGN_FEATURE_LABELS[variation.featureKey]}</span> changed:{" "}
          <span className="text-zinc-500 dark:text-zinc-400">{variation.previousValue}</span> →{" "}
          <span className="text-zinc-500 dark:text-zinc-400">{variation.newValue}</span>
        </p>
        <p className="text-zinc-400 dark:text-zinc-500">Created {new Date(variation.createdAt).toLocaleString()}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1 pt-0.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${VARIATION_DECISION_BADGE[variation.decision]}`}>
          {variation.decision === "KEPT_ORIGINAL" ? "KEPT ORIGINAL" : variation.decision}
        </span>
        <button
          type="button"
          disabled={busy || variation.decision === "SELECTED"}
          onClick={() => setConfirmSelectOpen(true)}
          className="rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          Select Variation
        </button>
        <button
          type="button"
          disabled={busy || variation.decision === "KEPT_ORIGINAL"}
          onClick={onKeepOriginal}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Keep Original
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCreateAnother}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Create Another Variation
        </button>
      </div>

      <ConfirmModal
        open={confirmSelectOpen}
        title="Select this variation?"
        message="This marks this variation as the preferred version of the design. The original image is never deleted — you can always come back and select it again later."
        confirmLabel="Select This Variation"
        isBusy={busy}
        onConfirm={() => {
          setConfirmSelectOpen(false);
          onSelect();
        }}
        onCancel={() => setConfirmSelectOpen(false)}
      />
    </div>
  );
}

const EMPTY_VARIATION_FORM = { featureKey: "SLEEVE" as DesignFeature, currentFeatureValue: "", newRequirement: "", additionalInstructions: "" };

/** The "MODIFY DESIGN" form — Feature to Change / Current Feature / New Requirement / Additional Instructions. The hidden AI image prompt is built entirely server-side from these fields; nothing here is ever shown to or free-typed as a raw prompt by the user. */
function DesignVariationModifyForm({
  open,
  parentImageId,
  onClose,
  onCreated,
  setError,
}: {
  open: boolean;
  parentImageId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [form, setForm] = useState(EMPTY_VARIATION_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/generated-images/${parentImageId}/design-variations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to generate this design variation.");
      setForm(EMPTY_VARIATION_FORM);
      await onCreated();
    } catch (err) {
      const message = (err as Error).message;
      setFormError(message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Modify Design" maxWidthClass="max-w-lg">
      <div className="space-y-3">
        {formError && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">{formError}</p>}

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Feature to Change</label>
          <select
            value={form.featureKey}
            onChange={(e) => setForm((f) => ({ ...f, featureKey: e.target.value as DesignFeature }))}
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {DESIGN_FEATURE_VALUES.map((key) => (
              <option key={key} value={key}>
                {DESIGN_FEATURE_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Current Feature</label>
          <input
            type="text"
            value={form.currentFeatureValue}
            onChange={(e) => setForm((f) => ({ ...f, currentFeatureValue: e.target.value }))}
            placeholder="Describe the feature as it appears in the image now"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">New Requirement</label>
          <textarea
            rows={2}
            value={form.newRequirement}
            onChange={(e) => setForm((f) => ({ ...f, newRequirement: e.target.value }))}
            placeholder="Describe what the feature should become"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Additional Instructions (optional)</label>
          <textarea
            rows={2}
            value={form.additionalInstructions}
            onChange={(e) => setForm((f) => ({ ...f, additionalInstructions: e.target.value }))}
            placeholder="Any further detail the AI should take into account"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !form.currentFeatureValue.trim() || !form.newRequirement.trim()}
            onClick={submit}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {submitting ? "Generating…" : "Generate Variation"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

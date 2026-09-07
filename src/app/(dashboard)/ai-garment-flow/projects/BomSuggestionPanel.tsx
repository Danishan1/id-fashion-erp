"use client";

import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

interface Option {
  id: string;
  name?: string;
  code?: string;
}

interface MaterialOption extends Option {
  styleName: string;
  styleCode: string;
  materialCategory: string | null;
  baseUom: { id: string; code: string } | null;
}

interface BomSuggestion {
  id: string;
  materialDescription: string;
  materialCategory: string;
  suggestedQuantityPerUnit: string | number;
  suggestedUom: string;
  suggestedWastagePercentage: string | number;
  colorNote: string | null;
  reasoning: string;
  decision: "PENDING" | "ADDED" | "DISMISSED";
}

function emptyResolveForm(suggestion: BomSuggestion) {
  return {
    materialId: "",
    colorId: "",
    quantityPerUnit: String(suggestion.suggestedQuantityPerUnit),
    wastagePercentage: String(suggestion.suggestedWastagePercentage),
    uomId: "",
    notes: suggestion.colorNote ? `Shade: ${suggestion.colorNote}` : "",
  };
}

export function BomSuggestionPanel({
  projectId,
  setError,
  reloadProject,
}: {
  projectId: string;
  setError: (e: string | null) => void;
  reloadProject: () => Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<BomSuggestion[] | undefined>(undefined);
  const [additionalGuidance, setAdditionalGuidance] = useState("");
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [resolveTarget, setResolveTarget] = useState<BomSuggestion | null>(null);
  const [resolveForm, setResolveForm] = useState(() => emptyResolveForm({ suggestedQuantityPerUnit: "", suggestedWastagePercentage: "0", colorNote: null } as BomSuggestion));
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [confirmContinue, setConfirmContinue] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/bom-suggestions`);
    const body = await res.json();
    if (res.ok) setSuggestions(body.data ?? []);
  }

  useEffect(() => {
    fetch(`/api/v1/ai-garment-projects/${projectId}/bom-suggestions`)
      .then((res) => res.json())
      .then((body) => setSuggestions(body.data ?? []));
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/colors")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
  }, [projectId]);

  async function generate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/bom-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalGuidance: additionalGuidance || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to generate a draft BOM.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function openResolve(suggestion: BomSuggestion) {
    setResolveForm(emptyResolveForm(suggestion));
    setResolveTarget(suggestion);
  }

  function onMaterialChange(materialId: string) {
    const material = materials.find((m) => m.id === materialId);
    setResolveForm((prev) => ({ ...prev, materialId, uomId: material?.baseUom?.id ?? prev.uomId }));
  }

  async function submitResolve() {
    if (!resolveTarget) return;
    setError(null);
    setBusyId(resolveTarget.id);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/bom-suggestions/${resolveTarget.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: resolveForm.materialId,
          colorId: resolveForm.colorId || undefined,
          quantityPerUnit: Number(resolveForm.quantityPerUnit),
          wastagePercentage: Number(resolveForm.wastagePercentage) || 0,
          uomId: resolveForm.uomId,
          notes: resolveForm.notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to add this suggestion to the BOM.");
      setResolveTarget(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/bom-suggestions/${id}/dismiss`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to dismiss this suggestion.");
      setConfirmDismissId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function continueToCosting() {
    setError(null);
    setBusyId("continue");
    try {
      const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/complete-bom-step`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to continue to Costing.");
      setConfirmContinue(false);
      await reloadProject();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Generate Draft BOM</h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Suggests a draft Bill of Materials for one finished garment, based on the approved design. Every suggestion is advisory —
          reviewing and resolving one into a real material below writes directly into this style&apos;s BOM (opened via the BOM Editor
          link once a Style exists).
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Additional guidance (optional)</label>
          <textarea
            rows={2}
            value={additionalGuidance}
            onChange={(e) => setAdditionalGuidance(e.target.value)}
            placeholder="e.g. This style needs a concealed zip, not a visible one"
            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <button
          type="button"
          disabled={generating}
          onClick={generate}
          className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {generating ? "Generating…" : "GENERATE DRAFT BOM"}
        </button>
      </div>

      {suggestions === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No draft BOM suggestions yet.</p>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <div key={s.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{s.materialDescription}</p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {s.materialCategory} · {String(s.suggestedQuantityPerUnit)} {s.suggestedUom} per piece · {String(s.suggestedWastagePercentage)}% wastage
                    {s.colorNote ? ` · ${s.colorNote}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{s.reasoning}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    s.decision === "ADDED"
                      ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                      : s.decision === "DISMISSED"
                        ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                  }`}
                >
                  {s.decision}
                </span>
              </div>
              {s.decision === "PENDING" && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => openResolve(s)}
                    className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Add to BOM
                  </button>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => setConfirmDismissId(s.id)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={busyId === "continue"}
        onClick={() => setConfirmContinue(true)}
        className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
      >
        Continue to Costing
      </button>

      <Modal open={resolveTarget !== null} onClose={() => setResolveTarget(null)} title="Add to BOM">
        {resolveTarget && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Every value below is editable — the AI&apos;s suggestion is only a starting point, never trusted as-is.
            </p>
            <FormField label="Raw Material" htmlFor="resolve-material" required>
              <MaterialPicker id="resolve-material" required materials={materials} value={resolveForm.materialId} onChange={onMaterialChange} />
            </FormField>
            <FormField label="Color (optional — blank applies to every color)" htmlFor="resolve-color">
              <select
                id="resolve-color"
                value={resolveForm.colorId}
                onChange={(e) => setResolveForm((prev) => ({ ...prev, colorId: e.target.value }))}
                className={textInputClass()}
              >
                <option value="">— All colors —</option>
                {colors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Qty per Piece" htmlFor="resolve-qty" required>
                <input
                  id="resolve-qty"
                  type="number"
                  min={0}
                  step="0.0001"
                  required
                  value={resolveForm.quantityPerUnit}
                  onChange={(e) => setResolveForm((prev) => ({ ...prev, quantityPerUnit: e.target.value }))}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Unit" htmlFor="resolve-uom" required>
                <select
                  id="resolve-uom"
                  required
                  value={resolveForm.uomId}
                  onChange={(e) => setResolveForm((prev) => ({ ...prev, uomId: e.target.value }))}
                  className={textInputClass()}
                >
                  <option value="">— Select —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Wastage %" htmlFor="resolve-wastage">
                <input
                  id="resolve-wastage"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={resolveForm.wastagePercentage}
                  onChange={(e) => setResolveForm((prev) => ({ ...prev, wastagePercentage: e.target.value }))}
                  className={textInputClass()}
                />
              </FormField>
            </div>
            <FormField label="Notes" htmlFor="resolve-notes">
              <input
                id="resolve-notes"
                value={resolveForm.notes}
                onChange={(e) => setResolveForm((prev) => ({ ...prev, notes: e.target.value }))}
                className={textInputClass()}
              />
            </FormField>
            <button
              type="button"
              disabled={busyId === resolveTarget.id || !resolveForm.materialId || !resolveForm.uomId || !resolveForm.quantityPerUnit}
              onClick={submitResolve}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busyId === resolveTarget.id ? "Saving…" : "Add to BOM"}
            </button>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={confirmDismissId !== null}
        title="Dismiss this suggestion?"
        message="This suggestion won't be added to the real BOM. You can still generate a new draft BOM later."
        confirmLabel="Dismiss"
        isDangerous
        isBusy={busyId === confirmDismissId}
        onConfirm={() => confirmDismissId && dismiss(confirmDismissId)}
        onCancel={() => setConfirmDismissId(null)}
      />

      <ConfirmModal
        open={confirmContinue}
        title="Continue to Costing?"
        message="This requires the style's BOM to already be approved in the BOM Editor. Moves the project's workflow forward to Costing."
        confirmLabel="Continue to Costing"
        isBusy={busyId === "continue"}
        onConfirm={continueToCosting}
        onCancel={() => setConfirmContinue(false)}
      />
    </div>
  );
}

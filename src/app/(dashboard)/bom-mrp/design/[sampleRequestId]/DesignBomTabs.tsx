"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import { BomVersionPanel } from "../../[productId]/BomVersionPanel";
import { BomEditor } from "../../BomEditor";

interface DesignMaterialRow {
  id: string;
  plannedQuantity: string;
  notes: string | null;
  material: { id: string; styleName: string; styleCode: string };
  color: { id: string; name: string; hexValue: string | null } | null;
  dye: { id: string; name: string; pantone: string | null } | null;
  uom: { id: string; code: string; name: string } | null;
}

interface StyleBomVersionRow {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "APPROVED" | "SUPERSEDED";
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string };
  approvedAt: string | null;
  approvedBy: { fullName: string } | null;
  items: unknown[];
}

interface StyleBomItemInput {
  materialId: string;
  colorId: string | null;
  quantityPerUnit: string;
  wastagePercentage: string;
  uomId: string;
  notes: string | null;
}

interface Option {
  id: string;
  name?: string;
  code?: string;
}

// The one place a design's "sample BOM" (its own SampleMaterial list) and
// its real Style BOM (once linked) are shown together — neither view
// duplicates the other's logic: the Design BOM tab edits through Sampling's
// own existing updateSampleMaterial()/removeSampleMaterial() endpoints
// (the same ones SampleWorkflowPanel's own Edit/Remove actions use — no new
// business logic here, just a second place to reach them from), and the
// Style BOM tab reuses BomVersionPanel/BomEditor completely unchanged, the
// exact same components the dedicated /bom-mrp/[productId] page renders.
export function DesignBomTabs({
  productId,
  styleLabel,
  materials: initialMaterials,
  canEditMaterials,
  styleBomVersions,
  styleBomCurrentVersionNumber,
  canApproveBom,
  initialStyleNotes,
  initialStyleItems,
  isStyleVersionLocked,
}: {
  productId: string | null;
  styleLabel: string | null;
  materials: DesignMaterialRow[];
  canEditMaterials: boolean;
  styleBomVersions: StyleBomVersionRow[];
  styleBomCurrentVersionNumber: number;
  canApproveBom: boolean;
  initialStyleNotes: string;
  initialStyleItems: StyleBomItemInput[];
  isStyleVersionLocked: boolean;
}) {
  const [tab, setTab] = useState<"design" | "style">("design");
  const [materials, setMaterials] = useState<DesignMaterialRow[]>(initialMaterials);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setTab("design")}
          className={`px-3 py-2 text-sm font-medium ${
            tab === "design"
              ? "border-b-2 border-indigo-600 text-indigo-600"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          Design BOM
        </button>
        {productId ? (
          <button
            type="button"
            onClick={() => setTab("style")}
            className={`px-3 py-2 text-sm font-medium ${
              tab === "style"
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Style BOM{styleLabel ? ` — ${styleLabel}` : ""}
          </button>
        ) : (
          <span
            className="cursor-not-allowed px-3 py-2 text-sm font-medium text-zinc-400 dark:text-zinc-600"
            title="This design has not been converted to a Style yet."
          >
            Style BOM
          </span>
        )}
      </div>

      {tab === "design" && (
        <DesignBomTable materials={materials} canEdit={canEditMaterials} onChanged={setMaterials} />
      )}

      {tab === "style" && productId && (
        <div className="space-y-4">
          <BomVersionPanel
            key={productId}
            productId={productId}
            versions={styleBomVersions}
            currentVersionNumber={styleBomCurrentVersionNumber}
            canApprove={canApproveBom}
          />
          <BomEditor
            key={`editor-${productId}`}
            productId={productId}
            initialNotes={initialStyleNotes}
            initialItems={initialStyleItems}
            isCurrentVersionLocked={isStyleVersionLocked}
            currentVersionNumber={styleBomCurrentVersionNumber}
          />
        </div>
      )}
    </div>
  );
}

function DesignBomTable({
  materials,
  canEdit,
  onChanged,
}: {
  materials: DesignMaterialRow[];
  canEdit: boolean;
  onChanged: (materials: DesignMaterialRow[]) => void;
}) {
  const [editTarget, setEditTarget] = useState<DesignMaterialRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesignMaterialRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sampling/materials/${deleteTarget.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to remove this material line.");
      onChanged(body.data);
      setDeleteTarget(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  if (materials.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No materials recorded on this design&rsquo;s current sample version yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Material</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Color</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Shade / Pantone</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Quantity</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Unit</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Notes</th>
              {canEdit && <th className="px-3 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {materials.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                  {m.material.styleName} <span className="text-xs text-zinc-400">({m.material.styleCode})</span>
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                  {m.color ? (
                    <span className="inline-flex items-center gap-1.5">
                      {m.color.hexValue && (
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-zinc-300 dark:border-zinc-700"
                          style={{ backgroundColor: m.color.hexValue }}
                        />
                      )}
                      {m.color.name}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                  {m.dye ? `${m.dye.name}${m.dye.pantone ? ` (${m.dye.pantone})` : ""}` : "—"}
                </td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{m.plannedQuantity}</td>
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{m.uom?.code ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{m.notes ?? "—"}</td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setEditTarget(m)}
                        className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(m)}
                        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <EditMaterialModal material={editTarget} onClose={() => setEditTarget(null)} onSaved={onChanged} />
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="Remove Material"
        message={
          deleteTarget
            ? `Remove "${deleteTarget.material.styleName}" from this design's BOM? This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        isDangerous
        isBusy={isDeleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function EditMaterialModal({
  material,
  onClose,
  onSaved,
}: {
  material: DesignMaterialRow;
  onClose: () => void;
  onSaved: (materials: DesignMaterialRow[]) => void;
}) {
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [dyes, setDyes] = useState<(Option & { pantone: string | null })[]>([]);

  const [materialId, setMaterialId] = useState(material.material.id);
  const [quantity, setQuantity] = useState(material.plannedQuantity);
  const [uomId, setUomId] = useState(material.uom?.id ?? "");
  const [colorId, setColorId] = useState(material.color?.id ?? "");
  const [dyeId, setDyeId] = useState(material.dye?.id ?? "");
  const [notes, setNotes] = useState(material.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/units?pageSize=200")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
    fetch("/api/v1/colors?pageSize=200")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/fabric-dyes")
      .then((res) => res.json())
      .then((body) => setDyes(body.data ?? []));
  }, []);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sampling/materials/${material.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          plannedQuantity: Number(quantity),
          uomId: uomId || undefined,
          colorId: colorId || undefined,
          dyeId: dyeId || undefined,
          notes: notes || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Failed to save this material line.");
      onSaved(body.data);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit Material — ${material.material.styleName}`} maxWidthClass="max-w-lg">
      <div className="space-y-3">
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>
        )}
        <FormField label="Material" htmlFor="editDesignBomMaterial" required>
          <MaterialPicker id="editDesignBomMaterial" required materials={materials} value={materialId} onChange={setMaterialId} />
        </FormField>
        <div className="grid grid-cols-3 gap-3">
          <FormField label="Quantity" htmlFor="editDesignBomQty" required>
            <input
              id="editDesignBomQty"
              type="number"
              min={0}
              step="0.0001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={textInputClass()}
            />
          </FormField>
          <FormField label="Unit" htmlFor="editDesignBomUom">
            <select id="editDesignBomUom" value={uomId} onChange={(e) => setUomId(e.target.value)} className={textInputClass()}>
              <option value="">— Unit —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Color" htmlFor="editDesignBomColor">
            <select id="editDesignBomColor" value={colorId} onChange={(e) => setColorId(e.target.value)} className={textInputClass()}>
              <option value="">— Optional —</option>
              {colors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Shade / Pantone (optional)" htmlFor="editDesignBomDye">
          <select id="editDesignBomDye" value={dyeId} onChange={(e) => setDyeId(e.target.value)} className={textInputClass()}>
            <option value="">— None —</option>
            {dyes.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.pantone ? ` (${d.pantone})` : ""}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Notes (optional)" htmlFor="editDesignBomNotes">
          <input id="editDesignBomNotes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} />
        </FormField>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSaving || !materialId || !quantity}
            onClick={handleSave}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

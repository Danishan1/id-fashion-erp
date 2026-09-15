"use client";

import { useEffect, useState } from "react";
import { textInputClass } from "@/components/ui/FormField";
import { MaterialPicker, type MaterialPickerOption } from "@/components/ui/MaterialPicker";
import { MATERIAL_ROLE_VALUES, type MaterialRole } from "@/modules/ai-designer/replicate-design.schema";
import { imageUrl, parseJson } from "./shared";

const MATERIAL_ROLE_LABELS: Record<MaterialRole, string> = {
  MAIN_FABRIC: "Main Fabric",
  CONTRAST_FABRIC: "Contrast Fabric",
  LINING: "Lining",
  INTERLINING: "Interlining",
  BUTTON: "Buttons",
  ZIPPER: "Zipper",
  THREAD: "Thread",
  LABEL: "Label",
  TRIM_OTHER: "Trim",
  OTHER: "Other Material",
};

interface UomOption {
  id: string;
  name: string;
  code: string;
}

interface MaterialLine {
  id: string;
  role: string;
  quantity: string | null;
  notes: string | null;
  product: { id: string; styleName: string; styleCode: string };
  uom: UomOption | null;
}

interface Props {
  projectId: string;
  fabricProductId: string | null;
  fabricImageAttachmentId: string | null;
  fabricName: string | null;
  fabricCode: string | null;
  materialLines: MaterialLine[];
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

export function FabricMaterialSelectionPanel({
  projectId,
  fabricProductId,
  fabricImageAttachmentId,
  fabricName,
  fabricCode,
  materialLines,
  busy,
  run,
}: Props) {
  const [materials, setMaterials] = useState<MaterialPickerOption[]>([]);
  const [units, setUnits] = useState<UomOption[]>([]);
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newRole, setNewRole] = useState<MaterialRole>("OTHER");
  const [newQuantity, setNewQuantity] = useState("");
  const [newUomId, setNewUomId] = useState("");
  const [newNotes, setNewNotes] = useState("");

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((r) => r.json())
      .then((body) => setMaterials(body.data ?? []))
      .catch(() => {});
    fetch("/api/v1/units?pageSize=200")
      .then((r) => r.json())
      .then((body) => setUnits(body.data ?? []))
      .catch(() => {});
  }, []);

  const fabricMaterials = materials.filter((m) => m.materialCategory === "FABRIC");

  const selectExisting = (productId: string) =>
    run("select-fabric", () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/fabric-existing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fabricProductId: productId }),
      }).then(parseJson)
    );

  const uploadFabricImage = (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return run("upload-fabric-image", () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/fabric-image`, { method: "POST", body: formData }).then(parseJson)
    );
  };

  const deleteFabricImage = () =>
    run("delete-fabric-image", () => fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/fabric-image`, { method: "DELETE" }).then(parseJson));

  const addLine = () =>
    run("add-line", () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/material-lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: newMaterialId,
          role: newRole,
          quantity: newQuantity ? Number(newQuantity) : undefined,
          uomId: newUomId || undefined,
          notes: newNotes || undefined,
        }),
      }).then(parseJson)
    ).then(() => {
      setNewMaterialId("");
      setNewRole("OTHER");
      setNewQuantity("");
      setNewUomId("");
      setNewNotes("");
    });

  const removeLine = (lineId: string) =>
    run(`remove-line-${lineId}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/material-lines/${lineId}`, { method: "DELETE" }).then(parseJson)
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-zinc-500">Pick from Fabric Master (name/code/supplier only — optional)</p>
          <div className="mt-1">
            <MaterialPicker materials={fabricMaterials} value={fabricProductId ?? ""} onChange={selectExisting} placeholder="Search existing fabric…" />
          </div>
          {(fabricName || fabricCode) && (
            <p className="mt-1 text-xs text-zinc-500">
              Selected: {fabricName} {fabricCode ? `(${fabricCode})` : ""}
            </p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
            Upload the fabric&apos;s real photo <span className="text-red-500">(required to Generate Design)</span>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            The generated design uses this exact photo as the new material — the Fabric Master above has no
            photo of its own, so even if you picked an existing fabric, you must still upload its actual
            image here.
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy === "upload-fabric-image"}
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFabricImage(file);
              e.target.value = "";
            }}
          />
          {fabricImageAttachmentId && (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(fabricImageAttachmentId)} alt="Fabric reference" className="h-24 w-24 rounded border object-cover" />
              <button
                type="button"
                disabled={busy === "delete-fabric-image"}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
                onClick={deleteFabricImage}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Other Raw Materials (trims, buttons, zippers, lining, …)</h3>
        {materialLines.length > 0 && (
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
                <th className="py-1 pr-2">Material</th>
                <th className="py-1 pr-2">Role</th>
                <th className="py-1 pr-2">Qty</th>
                <th className="py-1 pr-2">Notes</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {materialLines.map((line) => (
                <tr key={line.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-2">
                    {line.product.styleName} <span className="text-xs text-zinc-400">({line.product.styleCode})</span>
                  </td>
                  <td className="py-1 pr-2">{MATERIAL_ROLE_LABELS[line.role as MaterialRole] ?? line.role}</td>
                  <td className="py-1 pr-2">
                    {line.quantity ?? "—"} {line.uom?.code ?? ""}
                  </td>
                  <td className="py-1 pr-2 text-zinc-500">{line.notes ?? "—"}</td>
                  <td className="py-1">
                    <button
                      type="button"
                      disabled={busy === `remove-line-${line.id}`}
                      onClick={() => removeLine(line.id)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <div className="sm:col-span-2">
            <MaterialPicker materials={materials} value={newMaterialId} onChange={setNewMaterialId} placeholder="Search material…" />
          </div>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as MaterialRole)} className={textInputClass()}>
            {MATERIAL_ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {MATERIAL_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <input type="number" min="0" step="any" placeholder="Qty" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} className={textInputClass()} />
          <select value={newUomId} onChange={(e) => setNewUomId(e.target.value)} className={textInputClass()}>
            <option value="">Unit</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-5">
          <input
            placeholder="Notes (optional)"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            className={`${textInputClass()} sm:col-span-4`}
          />
          <button
            type="button"
            disabled={busy === "add-line" || !newMaterialId}
            onClick={addLine}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "add-line" ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

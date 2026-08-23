"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FormField, textInputClass } from "@/components/ui/FormField";
import { MaterialPicker } from "@/components/ui/MaterialPicker";

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

interface LineItem {
  materialId: string;
  colorId: string | null;
  quantityPerUnit: string;
  wastagePercentage: string;
  uomId: string;
  notes: string | null;
}

function emptyLine(): LineItem {
  return { materialId: "", colorId: null, quantityPerUnit: "", wastagePercentage: "0", uomId: "", notes: "" };
}

export function BomEditor({
  productId,
  initialNotes,
  initialItems,
}: {
  productId: string;
  initialNotes: string;
  initialItems: LineItem[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [items, setItems] = useState<LineItem[]>(initialItems.length > 0 ? initialItems : [emptyLine()]);
  const [materials, setMaterials] = useState<MaterialOption[]>([]);
  const [colors, setColors] = useState<Option[]>([]);
  const [units, setUnits] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/materials?pageSize=200")
      .then((res) => res.json())
      .then((body) => setMaterials(body.data ?? []));
    fetch("/api/v1/colors")
      .then((res) => res.json())
      .then((body) => setColors(body.data ?? []));
    fetch("/api/v1/units")
      .then((res) => res.json())
      .then((body) => setUnits(body.data ?? []));
  }, []);

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const onMaterialChange = (index: number, materialId: string) => {
    const material = materials.find((m) => m.id === materialId);
    updateItem(index, { materialId, uomId: material?.baseUom?.id ?? "" });
  };

  const addLine = () => setItems((prev) => [...prev, emptyLine()]);
  const removeLine = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSavedMessage(null);

    const payloadItems = items
      .filter((item) => item.materialId)
      .map((item) => ({
        materialId: item.materialId,
        colorId: item.colorId || undefined,
        quantityPerUnit: Number(item.quantityPerUnit),
        wastagePercentage: Number(item.wastagePercentage) || 0,
        uomId: item.uomId,
        notes: item.notes || undefined,
      }));

    const res = await fetch(`/api/v1/bom-mrp/${productId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || undefined, items: payloadItems }),
    });

    setIsSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Failed to save this BOM.");
      return;
    }

    setSavedMessage("Saved.");
    router.refresh();
  };

  return (
    <div className="max-w-4xl space-y-6">
      <FormField label="Notes" htmlFor="bom-notes">
        <input id="bom-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={textInputClass()} />
      </FormField>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Materials</h2>
        {items.map((item, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Line {index + 1}</span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="text-xs font-medium text-red-600 hover:text-red-500"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Raw Material" htmlFor={`material-${index}`} required>
                <MaterialPicker
                  id={`material-${index}`}
                  required
                  materials={materials}
                  value={item.materialId}
                  onChange={(materialId) => onMaterialChange(index, materialId)}
                />
              </FormField>
              <FormField label="Color (optional — blank applies to every color)" htmlFor={`color-${index}`}>
                <select
                  id={`color-${index}`}
                  value={item.colorId ?? ""}
                  onChange={(e) => updateItem(index, { colorId: e.target.value || null })}
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
            </div>

            <div className="grid grid-cols-4 gap-3">
              <FormField label="Qty per Piece" htmlFor={`qty-${index}`} required>
                <input
                  id={`qty-${index}`}
                  type="number"
                  min={0}
                  step="0.0001"
                  required
                  value={item.quantityPerUnit}
                  onChange={(e) => updateItem(index, { quantityPerUnit: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Unit" htmlFor={`uom-${index}`} required>
                <select
                  id={`uom-${index}`}
                  required
                  value={item.uomId}
                  onChange={(e) => updateItem(index, { uomId: e.target.value })}
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
              <FormField label="Wastage %" htmlFor={`wastage-${index}`}>
                <input
                  id={`wastage-${index}`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={item.wastagePercentage}
                  onChange={(e) => updateItem(index, { wastagePercentage: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
              <FormField label="Notes" htmlFor={`notes-${index}`}>
                <input
                  id={`notes-${index}`}
                  value={item.notes ?? ""}
                  onChange={(e) => updateItem(index, { notes: e.target.value })}
                  className={textInputClass()}
                />
              </FormField>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          + Add Line
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {savedMessage && <p className="text-sm text-green-600 dark:text-green-400">{savedMessage}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {isSaving ? "Saving…" : "Save BOM"}
      </button>
    </div>
  );
}

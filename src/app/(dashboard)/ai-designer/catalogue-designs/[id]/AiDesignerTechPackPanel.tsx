"use client";

import { useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";

export interface TechPackGarmentAnalysis {
  part1: {
    identification: Record<string, string>;
    construction: Record<string, string>;
    closure: { closureType: string; closureDetails: string };
    seamCallouts: { calloutNumber: number; location: string; technicalSpecification: string; status: string }[];
    visibleColors: { colorName: string; pantoneEstimate: string; hexEstimate: string; garmentPanel: string }[];
    suggestedColorways: {
      colorwayCode: string;
      colorwayName: string;
      mainColor: string;
      contrastColor: string;
      trimColor: string;
      artworkColor: string;
      notes: string;
    }[];
    artworkItems: {
      artworkType: string;
      placement: string;
      scale: string;
      dimensions: string;
      alignment: string;
      printMethod: string;
      distanceFromHps: string;
      distanceFromCf: string;
    }[];
    artworkSummary: string;
    patternPrintType: string;
    patternPrintNotes: string;
  };
  part2: {
    bomItems: { materialType: string; composition: string; gsm: string; color: string; consumption: string; notes: string }[];
    measurementPoints: { pointName: string; howToMeasure: string; toleranceCm: string; values: Record<string, string> }[];
    gradeRulesNotes: string;
    mainLabelSpec: string;
    sizeLabelSpec: string;
    careLabelSpec: string;
    hangtagSpec: string;
    polybagSpec: string;
    foldingInstructions: string;
    cartonPackingSpec: string;
    barcodePlacement: string;
  };
}

export interface TechPackPage {
  pageNumber: number;
  pageTitle: string;
  promptText: string | null;
  imageAttachmentId: string | null;
}

export interface TechPackData {
  id: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED";
  garmentAnalysisJson: TechPackGarmentAnalysis | null;
  designerNotes: string | null;
  suggestedAdditionalViews: string | null;
  errorMessage: string | null;
  approvalStatus: "DRAFT" | "APPROVED";
  revisionNumber: number;
  pages: TechPackPage[];
}

const IDENTIFICATION_FIELD_LABELS: Record<string, string> = {
  brandName: "Brand Name",
  styleName: "Style Name",
  styleNumber: "Style Number",
  garmentCategory: "Garment Category",
  subCategory: "Sub-Category",
  fitType: "Fit Type",
  genderCategory: "Gender / Category",
  targetSeason: "Target Season",
  baseSampleSize: "Base Sample Size",
  dateCreated: "Date Created",
  designer: "Designer",
};

const CONSTRUCTION_FIELD_LABELS: Record<string, string> = {
  silhouette: "Silhouette",
  bodyShape: "Body Shape",
  bodyLength: "Body Length",
  width: "Width",
  hemShape: "Hem Shape",
  sideSeamConstruction: "Side Seam Construction",
  shoulderConstruction: "Shoulder Construction",
  sleeveConstruction: "Sleeve Construction",
  hoodCollarConstruction: "Hood / Collar Construction",
  ribTrims: "Rib Trims",
  paneling: "Paneling",
  dropShoulderAmount: "Drop Shoulder Amount",
  cuffConstruction: "Cuff Construction",
  neckConstruction: "Neck Construction",
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
 * One inline click-to-edit field — the shared building block behind every
 * editable cell/row in this panel. Saving always goes through the caller's
 * own `onSave`, which itself calls the generic
 * `PATCH .../tech-pack/:id/field` endpoint (see `patchField` below) — this
 * component has no idea whether that edit lands in place or forks a new
 * revision; that's entirely the backend's own decision based on the tech
 * pack's current approval status.
 */
function EditableText({ value, onSave, multiline }: { value: string; onSave: (value: string) => Promise<void>; multiline?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="block w-full rounded px-1 -mx-1 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
        title="Click to edit"
      >
        {value || <span className="italic text-zinc-400">—</span>}
      </button>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-1">
      {multiline ? (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded border border-indigo-400 px-1.5 py-1 text-xs"
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded border border-indigo-400 px-1.5 py-1 text-xs"
        />
      )}
      <button type="button" disabled={saving} onClick={save} className="shrink-0 text-xs font-medium text-green-600 hover:underline disabled:opacity-50">
        ✓
      </button>
      <button type="button" disabled={saving} onClick={() => setEditing(false)} className="shrink-0 text-xs text-zinc-400 hover:underline">
        ✕
      </button>
    </div>
  );
}

/** Editable counterpart to the plain read-only KeyValueGrid this used to be. */
function EditableKeyValueList({
  items,
  onSave,
}: {
  items: { key: string; label: string; value: string }[];
  onSave: (key: string, value: string) => Promise<void>;
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.key} className="flex justify-between gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800">
          <dt className="shrink-0 text-zinc-500">{item.label}</dt>
          <dd className="flex-1 text-right text-zinc-800 dark:text-zinc-200">
            <EditableText value={item.value} onSave={(v) => onSave(item.key, v)} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface EditableColumn {
  header: string;
  /** Present only for columns that are actually editable (e.g. not a callout's own ordinal number). */
  field?: string;
  value: (rowIndex: number) => string;
  /** "values.<SIZE>" for a measurement point's own per-size cells. */
  fieldFor?: (rowIndex: number) => string;
}

/** Editable counterpart to the plain read-only MiniTable this used to be. */
function EditableDataTable({
  columns,
  rowCount,
  onSave,
}: {
  columns: EditableColumn[];
  rowCount: number;
  onSave: (rowIndex: number, field: string, value: string) => Promise<void>;
}) {
  if (rowCount === 0) return <p className="text-xs text-zinc-400">None.</p>;
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            {columns.map((c) => (
              <th key={c.header} className="px-2 py-1.5 font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              {columns.map((c) => (
                <td key={c.header} className="px-2 py-1.5">
                  {c.field || c.fieldFor ? (
                    <EditableText
                      value={c.value(rowIndex)}
                      onSave={(v) => onSave(rowIndex, c.fieldFor ? c.fieldFor(rowIndex) : c.field!, v)}
                    />
                  ) : (
                    c.value(rowIndex)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiDesignerTechPackPanel({
  projectId,
  techPack,
  busy,
  onGenerate,
  onChanged,
}: {
  projectId: string;
  techPack: TechPackData | null;
  busy: boolean;
  onGenerate: () => void;
  onChanged: (techPack: TechPackData) => void;
}) {
  const [forkBanner, setForkBanner] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reverting, setReverting] = useState(false);

  const patchField = async (input: { category: string; index?: number; field?: string; value: string }) => {
    if (!techPack) return;
    const body = await parseJson(
      await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/field`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
    );
    setForkBanner(
      body.data.forkedNewRevision
        ? `This edit created Revision ${body.data.techPack.revisionNumber} from the previously approved Revision ${body.data.techPack.revisionNumber - 1}.`
        : null
    );
    onChanged(body.data.techPack);
  };

  const approve = async () => {
    if (!techPack) return;
    setApproving(true);
    try {
      const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/approve`, { method: "POST" }));
      onChanged(body.data);
    } finally {
      setApproving(false);
      setConfirmApprove(false);
    }
  };

  const revert = async () => {
    if (!techPack) return;
    setReverting(true);
    try {
      const body = await parseJson(await fetch(`/api/v1/ai-designer/projects/${projectId}/tech-pack/${techPack.id}/revert`, { method: "POST" }));
      setForkBanner(null);
      onChanged(body.data);
    } finally {
      setReverting(false);
    }
  };

  const analysis = techPack?.garmentAnalysisJson;

  return (
    <div>
      <p className="text-xs text-zinc-500">
        A full, supplier-ready tech pack from the current design — a comprehensive garment analysis (categories A-J)
        rendered as real typeset text/tables in the exported PDF, plus the project&apos;s own real design photo on the
        pages that show one (Cover, Construction, Colorways) — never an AI-drawn substitute.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onGenerate}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Crafting your tech pack…" : "Generate Tech Pack"}
        </button>
        {techPack && techPack.status === "SUCCESS" && (
          <>
            {techPack.approvalStatus === "APPROVED" ? (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                Approved ✓ (Revision {techPack.revisionNumber})
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmApprove(true)}
                  className="rounded-md border border-green-600 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                >
                  Approve Tech Pack
                </button>
                <button
                  type="button"
                  disabled={reverting}
                  onClick={revert}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {reverting ? "Reverting…" : "Revert to AI-Generated"}
                </button>
              </>
            )}
          </>
        )}
      </div>
      {busy && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Please wait — this can take a minute: analyzing the design, then drafting the full garment analysis.
        </p>
      )}
      {forkBanner && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{forkBanner}</p>
      )}

      {techPack && techPack.status === "FAILED" && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{techPack.errorMessage || "Tech pack generation failed."}</p>
      )}

      {techPack && techPack.status === "SUCCESS" && analysis && (
        <div className="mt-4 space-y-4">
          <details className="rounded border border-zinc-200 dark:border-zinc-800" open>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">Garment Analysis</summary>
            <div className="space-y-4 border-t border-zinc-200 p-3 dark:border-zinc-800">
              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">A. Garment Identification</p>
                <EditableKeyValueList
                  items={Object.keys(IDENTIFICATION_FIELD_LABELS).map((key) => ({
                    key,
                    label: IDENTIFICATION_FIELD_LABELS[key],
                    value: analysis.part1.identification[key] ?? "",
                  }))}
                  onSave={(field, value) => patchField({ category: "identification", field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">B. Construction &amp; Silhouette</p>
                <EditableKeyValueList
                  items={Object.keys(CONSTRUCTION_FIELD_LABELS).map((key) => ({
                    key,
                    label: CONSTRUCTION_FIELD_LABELS[key],
                    value: analysis.part1.construction[key] ?? "",
                  }))}
                  onSave={(field, value) => patchField({ category: "construction", field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">C. Closure System</p>
                <EditableKeyValueList
                  items={[
                    { key: "closureType", label: "Type", value: analysis.part1.closure.closureType },
                    { key: "closureDetails", label: "Details", value: analysis.part1.closure.closureDetails },
                  ]}
                  onSave={(field, value) => patchField({ category: "closure", field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">D. Panels &amp; Seam Construction</p>
                <EditableDataTable
                  columns={[
                    { header: "#", value: (i) => String(analysis.part1.seamCallouts[i].calloutNumber) },
                    { header: "Location", field: "location", value: (i) => analysis.part1.seamCallouts[i].location },
                    {
                      header: "Technical Specification",
                      field: "technicalSpecification",
                      value: (i) => analysis.part1.seamCallouts[i].technicalSpecification,
                    },
                    { header: "Status", field: "status", value: (i) => analysis.part1.seamCallouts[i].status },
                  ]}
                  rowCount={analysis.part1.seamCallouts.length}
                  onSave={(rowIndex, field, value) => patchField({ category: "seamCallouts", index: rowIndex, field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">E. Colors &amp; Colorways</p>
                <p className="mb-1 text-xs text-zinc-500">Visible colors</p>
                <EditableDataTable
                  columns={[
                    { header: "Color", field: "colorName", value: (i) => analysis.part1.visibleColors[i].colorName },
                    { header: "Pantone (est.)", field: "pantoneEstimate", value: (i) => analysis.part1.visibleColors[i].pantoneEstimate },
                    { header: "HEX (est.)", field: "hexEstimate", value: (i) => analysis.part1.visibleColors[i].hexEstimate },
                    { header: "Panel", field: "garmentPanel", value: (i) => analysis.part1.visibleColors[i].garmentPanel },
                  ]}
                  rowCount={analysis.part1.visibleColors.length}
                  onSave={(rowIndex, field, value) => patchField({ category: "visibleColors", index: rowIndex, field, value })}
                />
                <p className="mb-1 mt-2 text-xs text-zinc-500">Suggested commercial colorways</p>
                <EditableDataTable
                  columns={[
                    { header: "Code", field: "colorwayCode", value: (i) => analysis.part1.suggestedColorways[i].colorwayCode },
                    { header: "Name", field: "colorwayName", value: (i) => analysis.part1.suggestedColorways[i].colorwayName },
                    { header: "Main", field: "mainColor", value: (i) => analysis.part1.suggestedColorways[i].mainColor },
                    { header: "Contrast", field: "contrastColor", value: (i) => analysis.part1.suggestedColorways[i].contrastColor },
                    { header: "Trim", field: "trimColor", value: (i) => analysis.part1.suggestedColorways[i].trimColor },
                    { header: "Artwork", field: "artworkColor", value: (i) => analysis.part1.suggestedColorways[i].artworkColor },
                    { header: "Notes", field: "notes", value: (i) => analysis.part1.suggestedColorways[i].notes },
                  ]}
                  rowCount={analysis.part1.suggestedColorways.length}
                  onSave={(rowIndex, field, value) => patchField({ category: "suggestedColorways", index: rowIndex, field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">F. Artwork &amp; Graphics</p>
                {analysis.part1.artworkItems.length > 0 && (
                  <EditableDataTable
                    columns={[
                      { header: "Type", field: "artworkType", value: (i) => analysis.part1.artworkItems[i].artworkType },
                      { header: "Placement", field: "placement", value: (i) => analysis.part1.artworkItems[i].placement },
                      { header: "Scale", field: "scale", value: (i) => analysis.part1.artworkItems[i].scale },
                      { header: "Dimensions", field: "dimensions", value: (i) => analysis.part1.artworkItems[i].dimensions },
                      { header: "Alignment", field: "alignment", value: (i) => analysis.part1.artworkItems[i].alignment },
                      { header: "Print Method", field: "printMethod", value: (i) => analysis.part1.artworkItems[i].printMethod },
                      { header: "From HPS", field: "distanceFromHps", value: (i) => analysis.part1.artworkItems[i].distanceFromHps },
                      { header: "From CF", field: "distanceFromCf", value: (i) => analysis.part1.artworkItems[i].distanceFromCf },
                    ]}
                    rowCount={analysis.part1.artworkItems.length}
                    onSave={(rowIndex, field, value) => patchField({ category: "artworkItems", index: rowIndex, field, value })}
                  />
                )}
                <div className="mt-1 text-xs text-zinc-500">
                  <EditableText
                    value={analysis.part1.artworkSummary}
                    multiline
                    onSave={(value) => patchField({ category: "artworkSummary", value })}
                  />
                </div>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">G. Pattern / Print</p>
                <EditableKeyValueList
                  items={[
                    { key: "patternPrintType", label: "Type", value: analysis.part1.patternPrintType },
                    { key: "patternPrintNotes", label: "Notes", value: analysis.part1.patternPrintNotes },
                  ]}
                  onSave={(field, value) => patchField({ category: field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">H. Bill of Materials</p>
                <EditableDataTable
                  columns={[
                    { header: "Material Type", field: "materialType", value: (i) => analysis.part2.bomItems[i].materialType },
                    { header: "Composition", field: "composition", value: (i) => analysis.part2.bomItems[i].composition },
                    { header: "GSM", field: "gsm", value: (i) => analysis.part2.bomItems[i].gsm },
                    { header: "Color", field: "color", value: (i) => analysis.part2.bomItems[i].color },
                    { header: "Consumption", field: "consumption", value: (i) => analysis.part2.bomItems[i].consumption },
                    { header: "Notes", field: "notes", value: (i) => analysis.part2.bomItems[i].notes },
                  ]}
                  rowCount={analysis.part2.bomItems.length}
                  onSave={(rowIndex, field, value) => patchField({ category: "bomItems", index: rowIndex, field, value })}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">I. Measurements &amp; Grading</p>
                <EditableDataTable
                  columns={[
                    { header: "Point", field: "pointName", value: (i) => analysis.part2.measurementPoints[i].pointName },
                    { header: "Tolerance", field: "toleranceCm", value: (i) => analysis.part2.measurementPoints[i].toleranceCm },
                    ...Object.keys(analysis.part2.measurementPoints[0]?.values ?? {}).map((size) => ({
                      header: size,
                      fieldFor: () => `values.${size}`,
                      value: (i: number) => analysis.part2.measurementPoints[i].values[size] ?? "",
                    })),
                  ]}
                  rowCount={analysis.part2.measurementPoints.length}
                  onSave={(rowIndex, field, value) => patchField({ category: "measurementPoints", index: rowIndex, field, value })}
                />
                <div className="mt-1 text-xs text-zinc-400">
                  <EditableText
                    value={analysis.part2.gradeRulesNotes}
                    multiline
                    onSave={(value) => patchField({ category: "gradeRulesNotes", value })}
                  />
                </div>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">J. Labels &amp; Packaging</p>
                <EditableKeyValueList
                  items={[
                    { key: "mainLabelSpec", label: "Main Label", value: analysis.part2.mainLabelSpec },
                    { key: "sizeLabelSpec", label: "Size Label", value: analysis.part2.sizeLabelSpec },
                    { key: "careLabelSpec", label: "Care Label", value: analysis.part2.careLabelSpec },
                    { key: "hangtagSpec", label: "Hangtag", value: analysis.part2.hangtagSpec },
                    { key: "polybagSpec", label: "Polybag", value: analysis.part2.polybagSpec },
                    { key: "foldingInstructions", label: "Folding Instructions", value: analysis.part2.foldingInstructions },
                    { key: "cartonPackingSpec", label: "Carton Packing", value: analysis.part2.cartonPackingSpec },
                    { key: "barcodePlacement", label: "Barcode Placement", value: analysis.part2.barcodePlacement },
                  ]}
                  onSave={(field, value) => patchField({ category: field, value })}
                />
              </section>
            </div>
          </details>

          {(techPack.designerNotes || techPack.suggestedAdditionalViews) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {techPack.designerNotes && (
                <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
                  <p className="mb-1 font-medium text-amber-800 dark:text-amber-300">Notes for Designer</p>
                  <p className="whitespace-pre-wrap text-amber-700 dark:text-amber-400">{techPack.designerNotes}</p>
                </div>
              )}
              {techPack.suggestedAdditionalViews && (
                <div className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                  <p className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">Suggested Additional Views</p>
                  <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{techPack.suggestedAdditionalViews}</p>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">7 Tech Pack Pages</p>
              <a
                href={`/api/v1/ai-designer/projects/${projectId}/tech-pack/download`}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Download Tech Pack (PDF)
              </a>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {techPack.pages
                .slice()
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((page) => (
                  <div key={page.pageNumber} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        Page {page.pageNumber} — {page.pageTitle}
                      </p>
                      {page.imageAttachmentId && (
                        <a
                          href={`/api/v1/ai-designer/attachments/${page.imageAttachmentId}/download`}
                          className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Download
                        </a>
                      )}
                    </div>
                    {page.imageAttachmentId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imageUrl(page.imageAttachmentId)}
                        alt={`Tech pack page ${page.pageNumber} — ${page.pageTitle} — the project's own real design photo`}
                        className="w-full rounded border bg-white object-contain"
                      />
                    ) : (
                      <p className="text-xs text-zinc-400">
                        This page has no photo — its tables are rendered as real text in the Garment Analysis above and
                        in the downloaded PDF.
                      </p>
                    )}
                    {page.promptText && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-zinc-500">View prompt</summary>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{page.promptText}</p>
                      </details>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmApprove}
        title="Approve this Tech Pack?"
        message="Approving locks this revision's data in place — any further edit will create a new revision instead of changing it, so this exact version stays reproducible."
        confirmLabel="Approve"
        isBusy={approving}
        onConfirm={approve}
        onCancel={() => setConfirmApprove(false)}
      />
    </div>
  );
}

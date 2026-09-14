"use client";

import { useEffect, useState } from "react";
import { imageUrl, parseJson } from "./shared";

// Mirrors AiDesignerWorkflowPanel.tsx's own Step 12 "Tech Pack" section
// exactly (same generic garment-analysis shape, since both reuse the exact
// same src/core/ai-designer/tech-pack/* pipeline) — a self-contained panel
// here rather than an inline section, matching this module's own established
// per-step-panel file convention (ReferenceImageUploadPanel/
// DesignDnaReviewPanel/etc.), unlike the sibling wizard's single monolithic
// file.

interface TechPackGarmentAnalysis {
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

interface TechPackPage {
  pageNumber: number;
  pageTitle: string;
  promptText: string;
  imageAttachmentId: string | null;
}

interface TechPackData {
  id: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILED";
  garmentAnalysisJson: TechPackGarmentAnalysis | null;
  designerNotes: string | null;
  suggestedAdditionalViews: string | null;
  errorMessage: string | null;
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

function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) return <p className="text-xs text-zinc-400">None.</p>;
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyValueGrid({ labels, data }: { labels: Record<string, string>; data: Record<string, string> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {Object.entries(labels).map(([key, label]) => (
        <div key={key} className="flex justify-between gap-2 border-b border-zinc-100 py-1 dark:border-zinc-800">
          <dt className="text-zinc-500">{label}</dt>
          <dd className="text-right text-zinc-800 dark:text-zinc-200">{data[key] || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TechPackPanel({
  projectId,
  hasCurrentDesign,
  busy,
  run,
}: {
  projectId: string;
  hasCurrentDesign: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [techPack, setTechPack] = useState<TechPackData | null>(null);

  useEffect(() => {
    fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/tech-pack`)
      .then(parseJson)
      .then((body) => setTechPack(body.data ?? null))
      .catch(() => {});
  }, [projectId]);

  if (!hasCurrentDesign) {
    return <p className="text-xs text-zinc-400">Generate a design first (Step 6) before creating its tech pack.</p>;
  }

  return (
    <div>
      <p className="text-xs text-zinc-500">
        A full, supplier-ready tech pack from the current generated design — a comprehensive garment analysis
        (categories A-J) plus 7 separately generated tech-pack page images (cover/style summary, construction
        callouts, BOM, colorways &amp; artwork, measurements, size grading, labels &amp; packaging).
      </p>
      <button
        type="button"
        disabled={busy === "tech-pack"}
        onClick={() =>
          run("tech-pack", async () => {
            const body = await parseJson(await fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/tech-pack`, { method: "POST" }));
            setTechPack(body.data);
          })
        }
        className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy === "tech-pack" ? "Crafting your tech pack…" : "Generate Tech Pack"}
      </button>
      {busy === "tech-pack" && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Please wait — this can take several minutes: analyzing the design, drafting the full garment analysis,
          writing 7 page prompts, then generating 7 separate tech-pack page images one at a time.
        </p>
      )}

      {techPack && techPack.status === "FAILED" && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">{techPack.errorMessage || "Tech pack generation failed."}</p>
      )}

      {techPack && techPack.status === "SUCCESS" && techPack.garmentAnalysisJson && (
        <div className="mt-4 space-y-4">
          <details className="rounded border border-zinc-200 dark:border-zinc-800" open>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">Garment Analysis</summary>
            <div className="space-y-4 border-t border-zinc-200 p-3 dark:border-zinc-800">
              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">A. Garment Identification</p>
                <KeyValueGrid labels={IDENTIFICATION_FIELD_LABELS} data={techPack.garmentAnalysisJson.part1.identification} />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">B. Construction &amp; Silhouette</p>
                <KeyValueGrid labels={CONSTRUCTION_FIELD_LABELS} data={techPack.garmentAnalysisJson.part1.construction} />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">C. Closure System</p>
                <p className="text-xs">
                  <span className="text-zinc-500">Type: </span>
                  {techPack.garmentAnalysisJson.part1.closure.closureType}
                </p>
                <p className="text-xs text-zinc-500">{techPack.garmentAnalysisJson.part1.closure.closureDetails}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">D. Panels &amp; Seam Construction</p>
                <MiniTable
                  headers={["#", "Location", "Technical Specification", "Status"]}
                  rows={techPack.garmentAnalysisJson.part1.seamCallouts.map((c) => [
                    String(c.calloutNumber),
                    c.location,
                    c.technicalSpecification,
                    c.status,
                  ])}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">E. Colors &amp; Colorways</p>
                <p className="mb-1 text-xs text-zinc-500">Visible colors</p>
                <MiniTable
                  headers={["Color", "Pantone (est.)", "HEX (est.)", "Panel"]}
                  rows={techPack.garmentAnalysisJson.part1.visibleColors.map((c) => [c.colorName, c.pantoneEstimate, c.hexEstimate, c.garmentPanel])}
                />
                <p className="mb-1 mt-2 text-xs text-zinc-500">Suggested commercial colorways</p>
                <MiniTable
                  headers={["Code", "Name", "Main", "Contrast", "Trim", "Artwork", "Notes"]}
                  rows={techPack.garmentAnalysisJson.part1.suggestedColorways.map((c) => [
                    c.colorwayCode,
                    c.colorwayName,
                    c.mainColor,
                    c.contrastColor,
                    c.trimColor,
                    c.artworkColor,
                    c.notes,
                  ])}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">F. Artwork &amp; Graphics</p>
                {techPack.garmentAnalysisJson.part1.artworkItems.length > 0 ? (
                  <MiniTable
                    headers={["Type", "Placement", "Scale", "Dimensions", "Alignment", "Print Method", "From HPS", "From CF"]}
                    rows={techPack.garmentAnalysisJson.part1.artworkItems.map((a) => [
                      a.artworkType,
                      a.placement,
                      a.scale,
                      a.dimensions,
                      a.alignment,
                      a.printMethod,
                      a.distanceFromHps,
                      a.distanceFromCf,
                    ])}
                  />
                ) : null}
                <p className="mt-1 text-xs text-zinc-500">{techPack.garmentAnalysisJson.part1.artworkSummary}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">G. Pattern / Print</p>
                <p className="text-xs">
                  <span className="text-zinc-500">Type: </span>
                  {techPack.garmentAnalysisJson.part1.patternPrintType}
                </p>
                <p className="text-xs text-zinc-500">{techPack.garmentAnalysisJson.part1.patternPrintNotes}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">H. Bill of Materials</p>
                <MiniTable
                  headers={["Material Type", "Composition", "GSM", "Color", "Consumption", "Notes"]}
                  rows={techPack.garmentAnalysisJson.part2.bomItems.map((b) => [b.materialType, b.composition, b.gsm, b.color, b.consumption, b.notes])}
                />
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">I. Measurements &amp; Grading</p>
                <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900">
                        <th className="px-2 py-1.5 font-medium">Point</th>
                        <th className="px-2 py-1.5 font-medium">Tolerance</th>
                        {Object.keys(techPack.garmentAnalysisJson.part2.measurementPoints[0]?.values ?? {}).map((size) => (
                          <th key={size} className="px-2 py-1.5 font-medium">
                            {size}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {techPack.garmentAnalysisJson.part2.measurementPoints.map((p) => (
                        <tr key={p.pointName} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                          <td className="px-2 py-1.5" title={p.howToMeasure}>
                            {p.pointName}
                          </td>
                          <td className="px-2 py-1.5 text-zinc-500">{p.toleranceCm}</td>
                          {Object.entries(p.values).map(([size, value]) => (
                            <td key={size} className="px-2 py-1.5">
                              {value}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{techPack.garmentAnalysisJson.part2.gradeRulesNotes}</p>
              </section>

              <section>
                <p className="mb-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">J. Labels &amp; Packaging</p>
                <dl className="space-y-1 text-xs">
                  {(
                    [
                      ["Main Label", techPack.garmentAnalysisJson.part2.mainLabelSpec],
                      ["Size Label", techPack.garmentAnalysisJson.part2.sizeLabelSpec],
                      ["Care Label", techPack.garmentAnalysisJson.part2.careLabelSpec],
                      ["Hangtag", techPack.garmentAnalysisJson.part2.hangtagSpec],
                      ["Polybag", techPack.garmentAnalysisJson.part2.polybagSpec],
                      ["Folding Instructions", techPack.garmentAnalysisJson.part2.foldingInstructions],
                      ["Carton Packing", techPack.garmentAnalysisJson.part2.cartonPackingSpec],
                      ["Barcode Placement", techPack.garmentAnalysisJson.part2.barcodePlacement],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label} className="flex gap-2">
                      <dt className="w-32 shrink-0 text-zinc-500">{label}</dt>
                      <dd className="text-zinc-800 dark:text-zinc-200">{value}</dd>
                    </div>
                  ))}
                </dl>
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
                href={`/api/v1/ai-designer/replicate-projects/${projectId}/tech-pack/download`}
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
                        alt={`Tech pack page ${page.pageNumber} — ${page.pageTitle}`}
                        className="w-full rounded border bg-white object-contain"
                      />
                    ) : (
                      <p className="text-xs text-zinc-400">
                        No garment artwork needed for this page — its tables are rendered as real text in the Garment
                        Analysis above and in the downloaded PDF.
                      </p>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-zinc-500">View prompt</summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{page.promptText}</p>
                    </details>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

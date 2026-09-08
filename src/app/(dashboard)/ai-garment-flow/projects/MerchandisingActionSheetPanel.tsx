"use client";

import { useState } from "react";

interface WorkflowProgressRow {
  key: string;
  label: string;
  completed: boolean;
  isCurrent: boolean;
}

interface MasData {
  project: {
    projectNumber: string;
    projectName: string;
    sourceType: "REFERENCE" | "FABRIC";
    status: string;
    currentStepKey: string;
    customerName: string | null;
    buyerName: string | null;
    brandName: string | null;
    seasonName: string | null;
    categoryName: string | null;
    targetMarket: string | null;
    targetCustomerProfile: string | null;
    targetSellingPrice: string | null;
    currencyCode: string | null;
    orderQuantityEstimate: string | null;
    styleCode: string | null;
    styleName: string | null;
  };
  workflowProgress: WorkflowProgressRow[];
  designDevelopment: {
    referenceAnalysisStatus: string | null;
    fabricAnalysisStatus: string | null;
    productSuitability: { status: string; highlySuitableCount: number; suitableCount: number } | null;
    designDirections: { total: number; approved: number; recommended: number; selected: { id: string; name: string; overallScore: number; classification: string } | null };
    generatedImages: { total: number; selectedCount: number };
    designVariations: { total: number };
    commercialEvaluation: { evaluatedAt: string; itemCount: number } | null;
  };
  fabricAndTechnical: {
    fabricApplication: { attempts: number; approved: boolean } | null;
    technicalFlat: { attempts: number; approved: boolean };
    technicalSpecification: { attempts: number; approved: boolean };
  };
  costingAndBom: {
    bomApproved: boolean;
    bomItemCount: number | null;
    bomSuggestions: { total: number; added: number; dismissed: number; pending: number };
    costAnalysis: { generatedAt: string; estimatedCostPerUnitLow: string; estimatedCostPerUnitHigh: string } | null;
    valueEngineering: { generatedAt: string; suggestionCount: number } | null;
  };
  buyerFeedback: { generatedAt: string; overallSummary: string; categories: { category: string; summary: string }[] } | null;
  samplingAndProduction: {
    sampleRequest: { requestNumber: string; status: string } | null;
    salesOrder: { orderNumber: string; status: string } | null;
    hasProductionOrder: boolean;
  };
  pendingActions: string[];
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-100 p-3 dark:border-zinc-800">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h5>
      <div className="mt-2 space-y-1 text-sm text-zinc-700 dark:text-zinc-200">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p>
      <span className="text-zinc-500 dark:text-zinc-400">{label}: </span>
      <span>{value ?? "—"}</span>
    </p>
  );
}

export function MerchandisingActionSheetPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MasData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!open && data === undefined) {
      try {
        const res = await fetch(`/api/v1/ai-garment-projects/${projectId}/merchandising-action-sheet`);
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load the Merchandising Action Sheet.");
        setData(body.data);
      } catch (err) {
        setError((err as Error).message);
      }
    }
    setOpen((o) => !o);
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-zinc-900 dark:text-zinc-50"
      >
        <span>Merchandising Action Sheet</span>
        <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-zinc-200 p-4 dark:border-zinc-800">
          {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}

          {data === undefined ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : data === null ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing to show yet.</p>
          ) : (
            <>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                A read-only rollup of this project&apos;s real status across every step — nothing here is AI-generated, it is
                assembled directly from the data already recorded elsewhere in this project.
              </p>

              <SectionCard title="Project">
                <Row label="Project" value={`${data.project.projectNumber} — ${data.project.projectName}`} />
                <Row label="Source" value={data.project.sourceType === "REFERENCE" ? "Reference photo" : "Fabric swatch"} />
                <Row label="Customer / Buyer" value={[data.project.customerName, data.project.buyerName].filter(Boolean).join(" / ") || null} />
                <Row label="Brand / Season / Category" value={[data.project.brandName, data.project.seasonName, data.project.categoryName].filter(Boolean).join(" / ") || null} />
                <Row label="Target Market" value={data.project.targetMarket} />
                <Row
                  label="Target Price / Currency"
                  value={data.project.targetSellingPrice ? `${data.project.targetSellingPrice} ${data.project.currencyCode ?? ""}`.trim() : null}
                />
                <Row label="Order Quantity Estimate" value={data.project.orderQuantityEstimate} />
                <Row label="Style" value={data.project.styleCode ? `${data.project.styleCode} — ${data.project.styleName}` : "Not yet graduated to a Style"} />
              </SectionCard>

              <SectionCard title="Workflow Progress">
                <div className="flex flex-wrap gap-1.5">
                  {data.workflowProgress.map((s) => (
                    <span
                      key={s.key}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        s.isCurrent
                          ? "bg-indigo-600 text-white"
                          : s.completed
                            ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {s.completed ? "✓ " : ""}
                      {s.label}
                    </span>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title="Design & Development">
                {data.project.sourceType === "REFERENCE" ? (
                  <Row label="Reference Analysis" value={data.designDevelopment.referenceAnalysisStatus} />
                ) : (
                  <>
                    <Row label="Fabric Analysis" value={data.designDevelopment.fabricAnalysisStatus} />
                    <Row
                      label="Product Suitability"
                      value={
                        data.designDevelopment.productSuitability
                          ? `${data.designDevelopment.productSuitability.status} (${data.designDevelopment.productSuitability.highlySuitableCount} highly suitable, ${data.designDevelopment.productSuitability.suitableCount} suitable)`
                          : null
                      }
                    />
                  </>
                )}
                <Row
                  label="Design Directions"
                  value={`${data.designDevelopment.designDirections.total} total, ${data.designDevelopment.designDirections.approved} approved, ${data.designDevelopment.designDirections.recommended} recommended`}
                />
                <Row
                  label="Selected Design"
                  value={
                    data.designDevelopment.designDirections.selected
                      ? `${data.designDevelopment.designDirections.selected.name} (score ${data.designDevelopment.designDirections.selected.overallScore}, ${data.designDevelopment.designDirections.selected.classification})`
                      : null
                  }
                />
                <Row label="Generated Visuals" value={`${data.designDevelopment.generatedImages.total} generated, ${data.designDevelopment.generatedImages.selectedCount} selected`} />
                <Row label="Design Variations" value={data.designDevelopment.designVariations.total} />
                <Row
                  label="Commercial Evaluation"
                  value={data.designDevelopment.commercialEvaluation ? `Compared ${data.designDevelopment.commercialEvaluation.itemCount} designs on ${new Date(data.designDevelopment.commercialEvaluation.evaluatedAt).toLocaleDateString()}` : null}
                />
              </SectionCard>

              <SectionCard title="Fabric & Technical">
                {data.fabricAndTechnical.fabricApplication && (
                  <Row
                    label="Fabric Application"
                    value={`${data.fabricAndTechnical.fabricApplication.attempts} attempt(s), ${data.fabricAndTechnical.fabricApplication.approved ? "approved" : "not yet approved"}`}
                  />
                )}
                <Row
                  label="Technical Flat"
                  value={`${data.fabricAndTechnical.technicalFlat.attempts} attempt(s), ${data.fabricAndTechnical.technicalFlat.approved ? "approved" : "not yet approved"}`}
                />
                <Row
                  label="Technical Specification"
                  value={`${data.fabricAndTechnical.technicalSpecification.attempts} attempt(s), ${data.fabricAndTechnical.technicalSpecification.approved ? "approved" : "not yet approved"}`}
                />
              </SectionCard>

              <SectionCard title="Costing & BOM">
                <Row label="BOM" value={data.costingAndBom.bomApproved ? `Approved (${data.costingAndBom.bomItemCount} items)` : "Not yet approved"} />
                <Row
                  label="BOM Suggestions"
                  value={`${data.costingAndBom.bomSuggestions.total} total — ${data.costingAndBom.bomSuggestions.added} added, ${data.costingAndBom.bomSuggestions.dismissed} dismissed, ${data.costingAndBom.bomSuggestions.pending} pending`}
                />
                <Row
                  label="Cost Analysis"
                  value={
                    data.costingAndBom.costAnalysis
                      ? `Estimated ${data.costingAndBom.costAnalysis.estimatedCostPerUnitLow}–${data.costingAndBom.costAnalysis.estimatedCostPerUnitHigh} per unit`
                      : null
                  }
                />
                <Row
                  label="Value Engineering"
                  value={data.costingAndBom.valueEngineering ? `${data.costingAndBom.valueEngineering.suggestionCount} suggestion(s)` : null}
                />
              </SectionCard>

              {data.buyerFeedback && (
                <SectionCard title="Buyer Feedback">
                  <p>{data.buyerFeedback.overallSummary}</p>
                  {data.buyerFeedback.categories.map((c, i) => (
                    <p key={i} className="text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium">{c.category}:</span> {c.summary}
                    </p>
                  ))}
                </SectionCard>
              )}

              <SectionCard title="Sampling & Production">
                <Row
                  label="Sample Request"
                  value={data.samplingAndProduction.sampleRequest ? `${data.samplingAndProduction.sampleRequest.requestNumber} — ${data.samplingAndProduction.sampleRequest.status}` : null}
                />
                <Row
                  label="Sales Order"
                  value={data.samplingAndProduction.salesOrder ? `${data.samplingAndProduction.salesOrder.orderNumber} — ${data.samplingAndProduction.salesOrder.status}` : null}
                />
                <Row label="Production Order" value={data.samplingAndProduction.hasProductionOrder ? "Exists" : "Not yet created"} />
              </SectionCard>

              {data.pendingActions.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-500/10">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Pending Actions</h5>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-amber-800 dark:text-amber-200">
                    {data.pendingActions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

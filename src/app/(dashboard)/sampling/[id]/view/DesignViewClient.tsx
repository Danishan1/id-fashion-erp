"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ProductImageGallery, type GalleryImage } from "@/components/ui/ProductImageGallery";
import { formatCategoryLabel } from "@/lib/format-category-label";
import { formatDate } from "@/lib/date-format";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "../../statusLabels";
import { SAMPLE_TYPE_LABELS } from "../../sampleTypeLabels";

interface SampleMaterialDetail {
  id: string;
  plannedQuantity: string;
  rate: string | null;
  gstPercentage: string | null;
  material: { styleName: string };
  uom: { code: string } | null;
  color: { name: string; hexValue: string | null } | null;
  dye: { name: string; pantone: string | null } | null;
}

interface SampleOtherChargeDetail {
  id: string;
  costHead: string;
  description: string;
  amount: string;
}

interface SampleVersionDetail {
  id: string;
  versionNumber: number;
  status: string;
  estimatedCostPerUnit: string | null;
  marginPercent: string | null;
  commissionPercent: string | null;
  freightAmount: string | null;
  costSubtotal: string | null;
  finalTotal: string | null;
  isCostingLocked: boolean;
  costingLockedBy: { fullName: string } | null;
  materials: SampleMaterialDetail[];
  otherCharges: SampleOtherChargeDetail[];
}

interface SampleRequestDetail {
  id: string;
  requestNumber: string;
  styleName: string | null;
  sampleType: keyof typeof SAMPLE_TYPE_LABELS | null;
  status: keyof typeof STATUS_LABELS;
  mainImageAttachmentId: string | null;
  requestDate: string;
  targetSubmissionDate: string | null;
  color: { name: string; hexValue: string | null } | null;
  customer: { name: string };
  buyer: { name: string } | null;
  product: { styleName: string; styleCode: string; id: string } | null;
  requestedBy: { fullName: string };
  versions: SampleVersionDetail[];
}

interface SampleAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

function inlineUrl(id: string) {
  return `/api/v1/sampling/attachments/${id}/download?disposition=inline`;
}

function downloadUrl(id: string) {
  return `/api/v1/sampling/attachments/${id}/download`;
}

function lineTotal(m: SampleMaterialDetail): number | null {
  if (m.rate === null) return null;
  const qty = Number(m.plannedQuantity);
  const rate = Number(m.rate);
  const gst = m.gstPercentage !== null ? Number(m.gstPercentage) : 0;
  return qty * rate * (1 + gst / 100);
}

interface DesignViewClientProps {
  sampleRequestId: string;
  initialRequest: SampleRequestDetail;
}

/**
 * The ecommerce-style "product page" for a Design (Sample Request) — big
 * main image + smaller thumbnails, design details, and the full Sampling
 * Cost breakdown (materials/charges/margin/commission/freight/final total)
 * from the current version, reusing the exact same field shapes
 * SampleWorkflowPanel's own costing sheet already reads, just read-only.
 */
export function DesignViewClient({ sampleRequestId, initialRequest }: DesignViewClientProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sampling/${sampleRequestId}/attachments`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const attachments: SampleAttachment[] = (body.data ?? []).filter((a: SampleAttachment) =>
          a.mimeType.startsWith("image/")
        );
        const ordered = [...attachments].sort((a, b) => {
          if (a.id === initialRequest.mainImageAttachmentId) return -1;
          if (b.id === initialRequest.mainImageAttachmentId) return 1;
          return 0;
        });
        setImages(
          ordered.map((a) => ({
            id: a.id,
            url: inlineUrl(a.id),
            downloadUrl: downloadUrl(a.id),
            fileName: a.fileName,
            mimeType: a.mimeType,
          }))
        );
        setIsLoadingImages(false);
      })
      .catch(() => setIsLoadingImages(false));
    return () => {
      cancelled = true;
    };
  }, [sampleRequestId, initialRequest.mainImageAttachmentId]);

  const r = initialRequest;
  const version = r.versions[0] ?? null;
  const displayName = r.styleName ?? r.product?.styleName ?? "Design";

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Sampling", href: "/sampling" },
            { label: r.requestNumber },
          ]}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {r.requestNumber} — {displayName}
          </h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[r.status]}`}>
            {STATUS_LABELS[r.status] ?? r.status}
          </span>
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {r.sampleType ? SAMPLE_TYPE_LABELS[r.sampleType] : "Not specified"}
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {r.customer.name}
          {r.buyer ? ` — ${r.buyer.name}` : ""} · Requested by {r.requestedBy.fullName} on {formatDate(r.requestDate)}
          {r.targetSubmissionDate ? ` · Target: ${formatDate(r.targetSubmissionDate)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {isLoadingImages ? (
            <div className="flex h-72 w-full items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800 sm:h-96">
              Loading…
            </div>
          ) : (
            <ProductImageGallery images={images} altText={displayName} />
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">Style</dt>
                <dd className="text-zinc-900 dark:text-zinc-50">{r.product?.styleName ?? "Not linked to a Style yet"}</dd>
              </div>
              <div className="flex items-center justify-between px-4 py-2 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">Color</dt>
                <dd className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-50">
                  {r.color ? (
                    <>
                      {r.color.hexValue && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-600"
                          style={{ backgroundColor: r.color.hexValue }}
                        />
                      )}
                      {r.color.name}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sampling Cost</h2>
            {!version ? (
              <p className="mt-1 text-sm text-zinc-500">No version has been created for this design yet.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {version.materials.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 font-medium">Color</th>
                          <th className="px-3 py-2 font-medium">Shade / Pantone</th>
                          <th className="px-3 py-2 font-medium">Qty</th>
                          <th className="px-3 py-2 font-medium">Rate / GST</th>
                          <th className="px-3 py-2 font-medium">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {version.materials.map((m) => {
                          const total = lineTotal(m);
                          return (
                            <tr key={m.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{m.material.styleName}</td>
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                                {m.color ? (
                                  <span className="flex items-center gap-1.5">
                                    {m.color.hexValue && (
                                      <span
                                        className="h-3 w-3 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-600"
                                        style={{ backgroundColor: m.color.hexValue }}
                                      />
                                    )}
                                    {m.color.name}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                                {m.dye ? `${m.dye.name}${m.dye.pantone ? ` (${m.dye.pantone})` : ""}` : "—"}
                              </td>
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                                {m.plannedQuantity} {m.uom?.code ?? ""}
                              </td>
                              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                                {m.rate !== null
                                  ? `${m.rate}${m.gstPercentage !== null ? ` (+${m.gstPercentage}% GST)` : ""}`
                                  : "—"}
                              </td>
                              <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                                {total !== null ? total.toFixed(2) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {version.otherCharges.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                          <th className="px-3 py-2 font-medium">Cost Head</th>
                          <th className="px-3 py-2 font-medium">Description</th>
                          <th className="px-3 py-2 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {version.otherCharges.map((c) => (
                          <tr key={c.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                              {formatCategoryLabel(c.costHead)}
                            </td>
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{c.description}</td>
                            <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{c.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Costing Summary</p>
                    {version.isCostingLocked && (
                      <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        Locked{version.costingLockedBy ? ` by ${version.costingLockedBy.fullName}` : ""}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-3">
                    <div>
                      <dt className="text-zinc-400">Cost Subtotal</dt>
                      <dd>{version.costSubtotal ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Margin %</dt>
                      <dd>{version.marginPercent ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Commission %</dt>
                      <dd>{version.commissionPercent ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Freight</dt>
                      <dd>{version.freightAmount ?? "0"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Cost / Unit</dt>
                      <dd>{version.estimatedCostPerUnit ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-400">Final Total</dt>
                      <dd className="font-medium text-zinc-900 dark:text-zinc-50">{version.finalTotal ?? "—"}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

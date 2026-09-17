"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ProductImageGallery, type GalleryImage } from "@/components/ui/ProductImageGallery";
import { formatDate } from "@/lib/date-format";

interface NamedLookup {
  name: string;
}

interface ProductDetail {
  id: string;
  styleCode: string;
  styleName: string;
  designNumber: string | null;
  gender: string | null;
  description: string | null;
  hsnSacCode: string | null;
  unitCost: string | null;
  reorderLevel: string | null;
  isActive: boolean;
  mainImageAttachmentId: string | null;
  category: NamedLookup | null;
  season: NamedLookup | null;
  brand: NamedLookup | null;
  productType: NamedLookup | null;
  productFitting: NamedLookup | null;
  variants: unknown[];
}

interface ProductAttachment {
  id: string;
  fileName: string;
  mimeType: string;
}

interface ApprovedDesign {
  id: string;
  requestNumber: string;
  styleName: string | null;
  versions: Array<{ estimatedCostPerUnit: string | null; customerDecisionAt: string | null }>;
}

function inlineUrl(id: string) {
  return `/api/v1/products/attachments/${id}/download?disposition=inline`;
}

function downloadUrl(id: string) {
  return `/api/v1/products/attachments/${id}/download`;
}

interface StyleViewClientProps {
  productId: string;
  initialProduct: ProductDetail;
}

/**
 * The ecommerce-style "product page" for a Style — big main image + smaller
 * thumbnails, style details, and a Sampling Cost rollup pulled from this
 * style's own approved designs (a Style carries no cost of its own; the real
 * cost figures live on each Sample Request's current version, same source
 * the Styles list's own "Designs (N)" count and the per-style Designs page
 * already read from).
 */
export function StyleViewClient({ productId, initialProduct }: StyleViewClientProps) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [designs, setDesigns] = useState<ApprovedDesign[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/products/${productId}/attachments`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        const attachments: ProductAttachment[] = (body.data ?? []).filter((a: ProductAttachment) =>
          a.mimeType.startsWith("image/")
        );
        const ordered = [...attachments].sort((a, b) => {
          if (a.id === initialProduct.mainImageAttachmentId) return -1;
          if (b.id === initialProduct.mainImageAttachmentId) return 1;
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
  }, [productId, initialProduct.mainImageAttachmentId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sampling?productId=${productId}&status=APPROVED&pageSize=200`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setDesigns(body.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setDesigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const p = initialProduct;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Styles", href: "/masters/products" },
            { label: p.styleName },
          ]}
        />
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{p.styleName}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              p.isActive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            }`}
          >
            {p.isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="mt-1 font-mono text-sm text-zinc-500 dark:text-zinc-400">{p.styleCode}</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          {isLoadingImages ? (
            <div className="flex h-72 w-full items-center justify-center rounded-lg border border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800 sm:h-96">
              Loading…
            </div>
          ) : (
            <ProductImageGallery images={images} altText={p.styleName} />
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <DetailRow label="Design Number" value={p.designNumber} />
              <DetailRow label="Garment Category" value={p.category?.name ?? null} />
              <DetailRow label="Season" value={p.season?.name ?? null} />
              <DetailRow label="Brand" value={p.brand?.name ?? null} />
              <DetailRow label="Product Type" value={p.productType?.name ?? null} />
              <DetailRow label="Fitting" value={p.productFitting?.name ?? null} />
              <DetailRow label="Gender" value={p.gender} />
              <DetailRow label="HSN / SAC Code" value={p.hsnSacCode} />
              <DetailRow label="Unit Cost" value={p.unitCost} />
              <DetailRow label="Reorder Level" value={p.reorderLevel} />
              <DetailRow label="Variants" value={String(p.variants.length)} />
            </dl>
          </div>

          {p.description && (
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Description</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.description}</p>
            </div>
          )}

          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sampling Cost</h2>
            {designs === null ? (
              <p className="mt-1 text-sm text-zinc-500">Loading…</p>
            ) : designs.length === 0 ? (
              <p className="mt-1 text-sm text-zinc-500">
                No approved sampling cost recorded yet for this style.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="px-3 py-2 font-medium">Request No.</th>
                      <th className="px-3 py-2 font-medium">Design Name</th>
                      <th className="px-3 py-2 font-medium">Approved Date</th>
                      <th className="px-3 py-2 font-medium">Cost / Unit</th>
                      <th className="px-3 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {designs.map((d) => (
                      <tr key={d.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className="px-3 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-200">
                          {d.requestNumber}
                        </td>
                        <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{d.styleName ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">
                          {d.versions[0]?.customerDecisionAt ? formatDate(d.versions[0].customerDecisionAt) : "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-50">
                          {d.versions[0]?.estimatedCostPerUnit ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/sampling/${d.id}/view`}
                            className="font-medium text-indigo-600 hover:text-indigo-500"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-50">{value || "—"}</dd>
    </div>
  );
}

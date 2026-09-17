"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Modal } from "@/components/ui/Modal";
import { ICON_BUTTON_CLASS, BomIcon, VariantsIcon, ImagesIcon } from "@/components/ui/icons";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/app/(dashboard)/sampling/statusLabels";
import { SampleImagesSection } from "@/app/(dashboard)/sampling/SampleImagesSection";
import { VariantsSection } from "../../VariantsSection";

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string;
  status: keyof typeof STATUS_LABELS;
  sampleType: string;
  mainImageAttachmentId: string | null;
  customer: { name: string } | null;
  // The current (highest-numbered) version's own decision date — matches
  // sample.repository.ts's findMany, since SampleRequest itself has no such
  // column, only SampleVersion does.
  versions: Array<{ customerDecisionAt: string | null }>;
}

interface DesignsListClientProps {
  productId: string;
  styleName: string;
  styleCode: string;
  variantCount: number;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function mainImageDownloadUrl(attachmentId: string) {
  return `/api/v1/sampling/attachments/${attachmentId}/download?disposition=inline`;
}

/**
 * A full page, not a modal — every APPROVED Sample Request ("Design") built
 * against this one style, i.e. every SampleRequest whose productId points
 * here and whose status is APPROVED (draft/rejected/in-progress samples
 * aren't real, confirmed designs yet — same scoping as the Styles list's
 * own "Designs (N)" count). Kept as its own client component (self-
 * fetching, same as the modal it replaces) so this page can grow real
 * sections/actions later without having to first migrate off a modal.
 */
export function DesignsListClient({ productId, styleName, styleCode, variantCount }: DesignsListClientProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [requests, setRequests] = useState<SampleRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [imagesFor, setImagesFor] = useState<SampleRequestRow | null>(null);
  // Variants belong to the linked Style, not to the design/sample itself
  // (SampleRequest has no Color/Size grid of its own) — every design on
  // this page shares the same one style, so this opens that style's own
  // existing Variants modal, just reachable from a design's row too.
  const [variantsOpen, setVariantsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sampling?productId=${productId}&status=APPROVED&pageSize=200`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (res.ok) {
          setRequests(body.data ?? []);
        } else {
          setError(body?.error?.message ?? "Failed to load designs.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load designs.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  return (
    <div className="space-y-4">
      <div>
        <Breadcrumb
          items={[
            { label: "Masters", href: "/masters" },
            { label: "Styles", href: "/masters/products" },
            { label: `Designs — ${styleName}` },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Designs — {styleName} <span className="font-mono text-sm font-normal text-zinc-400">({styleCode})</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every approved Sample Request (&ldquo;design&rdquo;) built against this style.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        {isLoading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : requests.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No approved sample requests have been built against this style yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium"></th>
                  <th className="px-4 py-2 font-medium">Request No.</th>
                  <th className="px-4 py-2 font-medium">Design Name</th>
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-4 py-2 font-medium">Approved Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      {r.mainImageAttachmentId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={mainImageDownloadUrl(r.mainImageAttachmentId)}
                          alt={r.styleName}
                          className="h-10 w-10 rounded object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-400 dark:bg-zinc-800">
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <a
                        href={`/sampling/${r.id}`}
                        className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {r.requestNumber}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{r.styleName}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{r.customer?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{formatDate(r.versions[0]?.customerDecisionAt ?? null)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-0.5">
                        <Link
                          href={`/bom-mrp/design/${r.id}`}
                          title="BOM"
                          aria-label="BOM"
                          className={ICON_BUTTON_CLASS}
                        >
                          <BomIcon />
                        </Link>
                        <button
                          type="button"
                          title={`Variants (${variantCount})`}
                          aria-label={`Variants (${variantCount})`}
                          onClick={() => setVariantsOpen(true)}
                          className={ICON_BUTTON_CLASS}
                        >
                          <VariantsIcon />
                        </button>
                        <button
                          type="button"
                          title="Images"
                          aria-label="Images"
                          onClick={() => setImagesFor(r)}
                          className={ICON_BUTTON_CLASS}
                        >
                          <ImagesIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {imagesFor && (
        <Modal open onClose={() => setImagesFor(null)} title={`Design Images — ${imagesFor.requestNumber}`} maxWidthClass="max-w-2xl">
          <SampleImagesSection key={imagesFor.id} sampleRequestId={imagesFor.id} />
        </Modal>
      )}

      {variantsOpen && <VariantsSection key={productId} productId={productId} onClose={() => setVariantsOpen(false)} />}
    </div>
  );
}

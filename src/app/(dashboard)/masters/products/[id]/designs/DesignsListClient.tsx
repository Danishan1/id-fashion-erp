"use client";

import { useEffect, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/app/(dashboard)/sampling/statusLabels";

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string;
  status: keyof typeof STATUS_LABELS;
  sampleType: string;
}

interface DesignsListClientProps {
  productId: string;
  styleName: string;
  styleCode: string;
}

/**
 * A full page, not a modal — every Sample Request ("Design") ever built
 * against this one style, i.e. every SampleRequest whose productId points
 * here. Kept as its own client component (self-fetching, same as the modal
 * it replaces) so this page can grow real sections/actions later without
 * having to first migrate off a modal.
 */
export function DesignsListClient({ productId, styleName, styleCode }: DesignsListClientProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [requests, setRequests] = useState<SampleRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sampling?productId=${productId}&pageSize=200`)
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
          Every Sample Request (&ldquo;design&rdquo;) ever built against this style.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        {isLoading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : requests.length === 0 ? (
          <p className="p-4 text-sm text-zinc-500">No sample requests have been built against this style yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="px-4 py-2 font-medium">Request No.</th>
                  <th className="px-4 py-2 font-medium">Design Name</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-4 py-2">
                      <a
                        href={`/sampling/${r.id}`}
                        className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {r.requestNumber}
                      </a>
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-200">{r.styleName}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[r.status]}`}>
                        {STATUS_LABELS[r.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { STATUS_LABELS, STATUS_BADGE_CLASS } from "@/app/(dashboard)/sampling/statusLabels";

interface SampleRequestRow {
  id: string;
  requestNumber: string;
  styleName: string;
  status: keyof typeof STATUS_LABELS;
  sampleType: string;
}

interface DesignNamesSectionProps {
  productId: string;
  /** The style's own real linked-sample count (Product._count.sampleRequests
   * from the list query) — shown in the row-action button label, mirroring
   * VariantsSection's own count-in-label treatment. */
  designCount: number;
}

/**
 * Rendered as a small row-action button on the Styles list, mirroring
 * VariantsSection's own row-action pattern — lists every Sample Request
 * ("Design Name") ever built against this specific style, i.e. every
 * SampleRequest whose productId points here. Self-fetches on open, since a
 * list row has no per-row detail fetch to piggyback on.
 */
export function DesignNamesSection({ productId, designCount }: DesignNamesSectionProps) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requests, setRequests] = useState<SampleRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function openModal() {
    setOpen(true);
    setError(null);
    setIsLoading(true);
    const res = await fetch(`/api/v1/sampling?productId=${productId}&pageSize=200`);
    const body = await res.json();
    setIsLoading(false);
    if (res.ok) {
      setRequests(body.data ?? []);
    } else {
      setError(body?.error?.message ?? "Failed to load design names.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="whitespace-nowrap rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Designs ({designCount})
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Design Names (Samples from this Style)" maxWidthClass="max-w-xl">
        <div className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-zinc-500">No sample requests have been built against this style yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">Request No.</th>
                    <th className="px-3 py-2 font-medium">Design Name</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="px-3 py-2">
                        <a
                          href={`/sampling/${r.id}`}
                          className="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          {r.requestNumber}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-zinc-700 dark:text-zinc-200">{r.styleName}</td>
                      <td className="px-3 py-2">
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

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

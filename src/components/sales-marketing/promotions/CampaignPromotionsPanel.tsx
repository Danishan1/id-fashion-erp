"use client";

import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDate } from "@/lib/date-format";
import { CARD, DisplayStatusBadge, discountText, useApi } from "./promotion-ui";

interface Row {
  id: string;
  code: string;
  name: string;
  displayStatus: string;
  approvedVersion: { number: number; discountType: string; value: number; validFrom: string; validTo: string | null } | null;
  usage: { reserved: number; redeemed: number };
}

/** Campaign → Promotions (Phase 12): promotions whose approved terms are limited to this campaign. Read-only. */
export function CampaignPromotionsPanel({ campaignId }: { campaignId: string }) {
  const { data, error, reload } = useApi<Row[] | null>(`/api/v1/sales-marketing/campaigns/${campaignId}/promotions`);
  if (error) return <div className={`${CARD} mt-4`}><ErrorState message={error} onRetry={reload} /></div>;
  if (data === null) return <div className={`${CARD} mt-4`}><LoadingState /></div>;
  if (!data?.length) return null;
  return (
    <section className={`${CARD} mt-4 space-y-2`}>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Promotions for this campaign</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">They price only quotations linked to this campaign. Uses are counts of issued quotations and Sales Orders — not a measure of the campaign&apos;s return.</p>
      <ul className="space-y-1 text-sm">
        {data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/sales-marketing/promotions/${p.id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              {p.code}
            </Link>
            <span>{p.name}</span>
            <DisplayStatusBadge status={p.displayStatus} />
            {p.approvedVersion && (
              <span className="text-xs text-zinc-500">
                {discountText(p.approvedVersion.discountType, p.approvedVersion.value)} · {formatDate(p.approvedVersion.validFrom)} – {p.approvedVersion.validTo ? formatDate(p.approvedVersion.validTo) : "open"}
              </span>
            )}
            <span className="text-xs text-zinc-500">
              {p.usage.reserved} reserved · {p.usage.redeemed} used
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

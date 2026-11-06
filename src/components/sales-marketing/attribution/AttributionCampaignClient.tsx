"use client";

import Link from "next/link";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDateTime } from "@/lib/date-format";
import { CHANNEL_TYPES, CONVERSION_TYPES, TOUCHPOINT_TYPES, type ConversionType, type TouchpointType } from "@/modules/sales-marketing/attribution/attribution-registry";
import { Badge, CARD, inr, useApi } from "./attribution-ui";

interface Detail {
  campaign: { id: string; code: string; name: string };
  model: { id: string; code: string; name: string; version?: number | null } | null;
  run: { id: string; from: string; to: string; finishedAt: string | null } | null;
  period?: { from: string; to: string };
  truncated?: boolean;
  conversions: {
    resultId: string;
    conversionType: ConversionType;
    reference: string;
    href: string | null;
    date: string;
    weight: number;
    values: { quoted: number | null; order: number | null; invoiced: number | null; quotedCredit: number | null; orderCredit: number | null; invoicedCredit: number | null } | null;
    touches: { campaign: string; thisCampaign: boolean; touchpointType: string; channelType: string | null; source: string; at: string; position: number; weight: number }[];
  }[];
}

const pct = (w: number) => `${(w * 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/** Attribution drill-down for one campaign: each credited conversion and the touches that shared it. */
export function AttributionCampaignClient({ campaignId, query }: { campaignId: string; query: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/v1/sales-marketing/attribution/campaigns/${campaignId}?${query}`);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <LoadingState />;
  if (!data.run) return <p className={`${CARD} text-sm text-zinc-500`}>There is no completed calculation for this model yet.</p>;
  return (
    <div className="space-y-4">
      <section className={`${CARD} text-sm`}>
        Model <span className="font-medium">{data.model?.code} v{data.model?.version ?? "?"}</span> · run {data.run.from} – {data.run.to}
        {data.run.finishedAt ? `, finished ${formatDateTime(data.run.finishedAt)}` : ""} · showing {data.period?.from} – {data.period?.to} ·{" "}
        <Link href={`/sales-marketing/campaigns/${data.campaign.id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
          open the campaign
        </Link>
        <p className="mt-1 text-xs text-zinc-500">People aren&apos;t shown here — only the business records and the kind of touch. Records you can&apos;t open in their own module are hidden, with their amounts.</p>
      </section>
      {data.conversions.length === 0 ? (
        <p className={`${CARD} text-sm text-zinc-500`}>No conversion in this period gave this campaign credit.</p>
      ) : (
        data.conversions.map((c) => (
          <section key={c.resultId} className={`${CARD} space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge>{CONVERSION_TYPES[c.conversionType].label}</Badge>
                {c.href ? (
                  <Link href={c.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                    {c.reference}
                  </Link>
                ) : (
                  <span className="text-zinc-500">{c.reference}</span>
                )}
                <span className="text-xs text-zinc-500">{c.date}</span>
              </div>
              <div className="text-sm">
                This campaign: <span className="font-semibold">{pct(c.weight)}</span>
                {c.values?.orderCredit !== null && c.values?.orderCredit !== undefined && ` · ${inr(c.values.orderCredit)} of ${inr(c.values.order)} order value`}
                {c.values?.invoicedCredit !== null && c.values?.invoicedCredit !== undefined && c.values.invoiced ? ` · ${inr(c.values.invoicedCredit)} of ${inr(c.values.invoiced)} invoiced` : ""}
                {c.values?.quotedCredit !== null && c.values?.quotedCredit !== undefined && ` · ${inr(c.values.quotedCredit)} of ${inr(c.values.quoted)} quoted`}
              </div>
            </div>
            <ol className="space-y-0.5 text-sm">
              {c.touches.map((t) => (
                <li key={t.position} className={t.thisCampaign ? "" : "text-zinc-500"}>
                  {t.position}. {t.campaign} · {TOUCHPOINT_TYPES[t.touchpointType as TouchpointType]?.label ?? t.touchpointType}
                  {t.channelType ? ` (${CHANNEL_TYPES[t.channelType as keyof typeof CHANNEL_TYPES] ?? t.channelType})` : ` (${t.source.toLowerCase().replace(/_/g, " ")})`} · {formatDateTime(t.at)} · {pct(t.weight)}
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
      {data.truncated && <p className="text-xs text-zinc-500">Showing the latest 300 conversions. Narrow the period to see older ones.</p>}
    </div>
  );
}

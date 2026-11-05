"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/PageStates";
import { formatDate } from "@/lib/date-format";
import type { SalesMarketingMetrics } from "@/modules/sales-marketing/sales-marketing-metrics.service";

const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rate = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`);
const tile = "flex flex-col rounded-md border border-zinc-200 p-3 dark:border-zinc-800";
const tileLink = `${tile} hover:border-indigo-300 hover:bg-indigo-50/40 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30`;

function Tile({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="mt-1 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{value}</span>
      {note && <span className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
    </>
  );
  return href ? (
    <Link href={href} className={tileLink}>
      {body}
    </Link>
  ) : (
    <div className={tile}>{body}</div>
  );
}

/** Sales & Marketing KPIs (S6): real figures in the viewer's scope; definitions in the footnote. */
export function SalesMarketingKpis() {
  const [days, setDays] = useState(90);
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: SalesMarketingMetrics }>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sales-marketing/metrics?days=${days}`, { headers: { "x-toast": "off" } })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setState({ status: "error", message: body?.error?.message ?? "Could not load the figures." });
        else setState({ status: "ready", data: body.data });
      })
      .catch(() => !cancelled && setState({ status: "error", message: "Could not reach the server." }));
    return () => {
      cancelled = true;
    };
  }, [days, retry]);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="sm-kpis">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sm-kpis" className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Sales &amp; marketing KPIs
        </h2>
        <div className="flex items-center gap-3">
          <Link href="/reports/sales-marketing" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Reports
          </Link>
          <div className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Period">
            {[30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={days === d}
                onClick={() => {
                  setState({ status: "loading" });
                  setDays(d);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium ${days === d ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {d === 365 ? "12 months" : `${d} days`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {state.status === "loading" && <LoadingState />}
      {state.status === "error" && (
        <ErrorState
          message={state.message}
          onRetry={() => {
            setState({ status: "loading" });
            setRetry((r) => r + 1);
          }}
        />
      )}
      {state.status === "ready" && <Figures m={state.data} />}
    </section>
  );
}

function Figures({ m }: { m: SalesMarketingMetrics }) {
  const period = `${formatDate(m.periodFrom)} – ${formatDate(m.today)}`;
  return (
    <div className="mt-3 space-y-4">
      {m.enquiries && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Enquiries (now)</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Open enquiries" value={m.enquiries.open.toLocaleString("en-IN")} href="/sales-marketing/enquiries" />
            <Tile label="Overdue follow-ups" value={m.enquiries.overdueFollowUps.toLocaleString("en-IN")} href="/sales-marketing/enquiries" />
            <Tile label="Awaiting qualification" value={m.enquiries.awaitingQualification.toLocaleString("en-IN")} note="New or under review" href="/sales-marketing/enquiries" />
            <Tile label="Enquiry → quotation" value={rate(m.enquiries.quotationRate)} note={`${m.enquiries.quotedInPeriod} of ${m.enquiries.receivedInPeriod} enquiries in the period got an issued quotation`} />
          </div>
        </div>
      )}
      {m.quotations && (
        <>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Quotations by status (now, value incl. GST)</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {m.quotations.byStatus.map((s) => (
                <Tile key={s.key} label={s.label} value={s.count.toLocaleString("en-IN")} note={inr(s.value)} href="/sales-marketing/quotations" />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Results in the period ({period})</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Win rate" value={rate(m.quotations.decisions.winRate)} note={`${m.quotations.decisions.accepted} accepted, ${m.quotations.decisions.rejected} rejected`} />
              <Tile label="Quote → order" value={rate(m.quotations.conversion.rate)} note={`${m.quotations.conversion.converted} of ${m.quotations.conversion.accepted} accepted quotations are Sales Orders`} />
              {m.orders && <Tile label="Orders from quotations" value={m.orders.count.toLocaleString("en-IN")} note={`${inr(m.orders.value)} before GST`} href="/sales-orders" />}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Top customers by accepted value (period)</h3>
            {m.quotations.topCustomers.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No accepted quotations in this period.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {m.quotations.topCustomers.map((c) => (
                    <tr key={c.customerId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                      <td className="py-1.5">{c.name}</td>
                      <td className="py-1.5 text-right text-zinc-500">{c.accepted} accepted</td>
                      <td className="py-1.5 text-right tabular-nums">{inr(c.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
      {!m.enquiries && !m.quotations && <p className="text-sm text-zinc-500">You don&apos;t have access to enquiries or quotations.</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Only records you can see are counted. Expired = issued and past its valid-until date. Win rate = accepted ÷ (accepted + rejected) customer decisions recorded in the period. Quote → order = accepted in the period that
        already have a Sales Order. Enquiry → quotation = enquiries dated in the period with at least one issued quotation.
      </p>
    </div>
  );
}

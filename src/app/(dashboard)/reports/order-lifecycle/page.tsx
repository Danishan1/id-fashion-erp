"use client";

import { useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { formatDate } from "@/lib/date-format";

interface OrderOption {
  id: string;
  orderNumber: string;
  customer: { name: string };
}

interface LifecycleSections {
  order?: {
    orderNumber: string;
    orderDate: string;
    status: string;
    customer: { name: string };
    totalAmount: number;
    items: { styleCode: string; styleName: string; unitPrice: number; orderedQuantity: number }[];
  };
  sampling?: { requestNumber: string; styleName: string | null; status: string; sampleType: string | null }[];
  materialRequests?: { requestNumber: string; requestType: string; warehouse: string; lines: { material: string; requestedQuantity: number; issuedQuantity: number }[] }[];
  purchase?: { orderNumber: string; status: string; supplier: string; material: string; orderedQuantity: number; receivedQuantity: number }[];
  production?: { orderNumber: string; status: string; style: string; plannedQuantity: number }[];
  qc?: { inspectedAt: string; inspectedQuantity: number; acceptedQuantity: number; rejectedQuantity: number; result: string }[];
  dispatch?: { dispatchNumber: string; dispatchDate: string; status: string; transporterName: string | null; cartons: { cartonNumber: number; totalQuantity: number }[] }[];
  invoices?: { invoiceNumber: string; invoiceDate: string; status: string; totalAmount: number; paidAmount: number }[];
  payments?: { paymentNumber: string; paymentDate: string; status: string; allocatedAmount: number }[];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      {children}
    </div>
  );
}

export default function OrderLifecyclePage() {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<OrderOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [sections, setSections] = useState<LifecycleSections | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = () => {
    fetch(`/api/v1/sales-orders?search=${encodeURIComponent(search)}&pageSize=10`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((body) => setOptions(body.data ?? []))
      .catch(() => setOptions([]));
  };

  const selectOrder = (id: string) => {
    setSelectedOrderId(id);
    setSections(null);
    setError(null);
    fetch(`/api/v1/reports/order-lifecycle/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? "Failed to load order lifecycle.");
        }
        return res.json();
      })
      .then((body) => setSections(body.sections))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Report Center", href: "/reports" }, { label: "Order Lifecycle Report" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Order Lifecycle Report</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Order → Sampling → Material Requirement → Purchase → Production → QC → Dispatch → Invoice → Payment, for one Sales Order. Sections you don&apos;t
          have permission to view are omitted, not shown-then-blocked.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="Search order number or customer…"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={runSearch}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Search
        </button>
      </div>

      {options.length > 0 && !selectedOrderId ? (
        <div className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => selectOrder(o.id)}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
            >
              {o.orderNumber} — {o.customer.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {selectedOrderId && !sections && !error ? <p className="text-sm text-zinc-500">Loading…</p> : null}

      {sections ? (
        <div className="space-y-4">
          {sections.order ? (
            <Section title={`Order — ${sections.order.orderNumber} (${sections.order.status})`}>
              <p className="text-xs text-zinc-500">
                {sections.order.customer.name} · {formatDate(sections.order.orderDate)} · ₹{sections.order.totalAmount.toLocaleString("en-IN")}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                {sections.order.items.map((it, i) => (
                  <li key={i}>
                    {it.styleCode} — {it.styleName}: {it.orderedQuantity} pcs @ ₹{it.unitPrice}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {sections.sampling ? (
            <Section title="Sampling">
              {sections.sampling.length === 0 ? (
                <p className="text-xs text-zinc-500">No linked samples.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.sampling.map((s, i) => (
                    <li key={i}>
                      {s.requestNumber} — {s.styleName ?? "—"} ({s.sampleType ?? "—"}): {s.status}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {sections.materialRequests ? (
            <Section title="Material Requirement">
              {sections.materialRequests.length === 0 ? (
                <p className="text-xs text-zinc-500">No material requests raised for this order.</p>
              ) : (
                sections.materialRequests.map((mr, i) => (
                  <div key={i} className="mb-2 text-xs text-zinc-700 dark:text-zinc-300">
                    <p className="font-medium">
                      {mr.requestNumber} ({mr.requestType}) — {mr.warehouse}
                    </p>
                    <ul className="ml-3 list-disc">
                      {mr.lines.map((l, j) => (
                        <li key={j}>
                          {l.material}: requested {l.requestedQuantity}, issued {l.issuedQuantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Section>
          ) : null}

          {sections.purchase ? (
            <Section title="Purchase">
              {sections.purchase.length === 0 ? (
                <p className="text-xs text-zinc-500">No purchase orders traced to this order.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.purchase.map((p, i) => (
                    <li key={i}>
                      {p.orderNumber} — {p.supplier} — {p.material}: ordered {p.orderedQuantity}, received {p.receivedQuantity} ({p.status})
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {sections.production ? (
            <Section title="Production">
              {sections.production.length === 0 ? (
                <p className="text-xs text-zinc-500">No production orders for this order&apos;s lines.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.production.map((p, i) => (
                    <li key={i}>
                      {p.orderNumber} — {p.style}: planned {p.plannedQuantity} ({p.status})
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {sections.qc ? (
            <Section title="Quality (QC)">
              {sections.qc.length === 0 ? (
                <p className="text-xs text-zinc-500">No QC inspections recorded.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.qc.map((q, i) => (
                    <li key={i}>
                      {formatDate(q.inspectedAt)}: inspected {q.inspectedQuantity}, accepted {q.acceptedQuantity}, rejected{" "}
                      {q.rejectedQuantity} — {q.result}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {sections.dispatch ? (
            <Section title="Packing & Dispatch">
              {sections.dispatch.length === 0 ? (
                <p className="text-xs text-zinc-500">Not yet dispatched.</p>
              ) : (
                sections.dispatch.map((d, i) => (
                  <div key={i} className="mb-2 text-xs text-zinc-700 dark:text-zinc-300">
                    <p className="font-medium">
                      {d.dispatchNumber} — {formatDate(d.dispatchDate)} ({d.status}) {d.transporterName ? `via ${d.transporterName}` : ""}
                    </p>
                    <ul className="ml-3 list-disc">
                      {d.cartons.map((c, j) => (
                        <li key={j}>
                          Carton #{c.cartonNumber}: {c.totalQuantity} pcs
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </Section>
          ) : null}

          {sections.invoices ? (
            <Section title="Invoice">
              {sections.invoices.length === 0 ? (
                <p className="text-xs text-zinc-500">Not yet invoiced.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.invoices.map((inv, i) => (
                    <li key={i}>
                      {inv.invoiceNumber} — {formatDate(inv.invoiceDate)}: ₹{inv.totalAmount.toLocaleString("en-IN")} (paid ₹
                      {inv.paidAmount.toLocaleString("en-IN")}) — {inv.status}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}

          {sections.payments ? (
            <Section title="Payment">
              {sections.payments.length === 0 ? (
                <p className="text-xs text-zinc-500">No payments received against this order&apos;s invoices yet.</p>
              ) : (
                <ul className="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
                  {sections.payments.map((p, i) => (
                    <li key={i}>
                      {p.paymentNumber} — {formatDate(p.paymentDate)}: ₹{p.allocatedAmount.toLocaleString("en-IN")} ({p.status})
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

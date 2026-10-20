"use client";

import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

type Segment = "NEW" | "REPEAT" | "HIGH_VALUE" | "VIP" | "DORMANT" | "INACTIVE";

interface CustomerSegmentRow {
  id: string;
  code: string;
  name: string;
  type: string;
  country: string | null;
  orderCount: number;
  totalOrderValue: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  segments: Segment[];
}

interface CategoryRow {
  categoryId: string;
  categoryName: string;
  customerCount: number;
  orderCount: number;
}

const SEGMENT_LABELS: Record<Segment, string> = {
  NEW: "New",
  REPEAT: "Repeat",
  HIGH_VALUE: "High Value",
  VIP: "VIP",
  DORMANT: "Dormant",
  INACTIVE: "Inactive",
};

const SEGMENT_BADGE_CLASS: Record<Segment, string> = {
  NEW: "bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
  REPEAT: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  HIGH_VALUE: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  VIP: "bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-300",
  DORMANT: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  INACTIVE: "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

export default function CustomerSegmentsPage() {
  const [customers, setCustomers] = useState<CustomerSegmentRow[] | null>(null);
  const [categories, setCategories] = useState<CategoryRow[] | null>(null);
  const [activeSegment, setActiveSegment] = useState<Segment | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);

  const load = () => {
    fetch("/api/v1/customers/segments")
      .then((res) => res.json())
      .then((body) => setCustomers(body.data));
    fetch("/api/v1/customers/category-breakdown")
      .then((res) => res.json())
      .then((body) => setCategories(body.data));
  };

  useEffect(load, []);

  const generateReengagement = async () => {
    setIsGenerating(true);
    setGenerateResult(null);
    const res = await fetch("/api/v1/customers/generate-reengagement-followups", { method: "POST" });
    const body = await res.json();
    setIsGenerating(false);
    if (res.ok) {
      setGenerateResult(`Checked ${body.data.checked} customer(s) inactive 60+ days — ${body.data.created} new re-engagement follow-up(s) created.`);
      load();
    }
  };

  const counts = useMemo(() => {
    const c: Record<Segment, number> = { NEW: 0, REPEAT: 0, HIGH_VALUE: 0, VIP: 0, DORMANT: 0, INACTIVE: 0 };
    customers?.forEach((row) => row.segments.forEach((s) => c[s]++));
    return c;
  }, [customers]);

  const filtered = useMemo(() => {
    if (!customers) return [];
    if (!activeSegment) return customers;
    return customers.filter((c) => c.segments.includes(activeSegment));
  }, [customers, activeSegment]);

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Marketing", href: "/marketing" }, { label: "Customer Segments" }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customer Segments</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Derived live from real order history — New/Repeat/High Value/VIP/Dormant/Inactive, by recency, frequency, and order value. No customer type
            (retail/wholesale/distributor/export) or region master exists in this system yet, so segmentation is scoped to what&apos;s real today.
          </p>
        </div>
        <button
          type="button"
          onClick={generateReengagement}
          disabled={isGenerating}
          className="whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isGenerating ? "Checking…" : "Generate Re-engagement Follow-ups"}
        </button>
      </div>

      {generateResult && <p className="text-sm text-zinc-600 dark:text-zinc-300">{generateResult}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActiveSegment((prev) => (prev === s ? null : s))}
            className={`rounded-lg border p-3 text-left transition ${
              activeSegment === s ? "border-indigo-500 ring-1 ring-indigo-500" : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="text-xs font-medium uppercase text-zinc-500">{SEGMENT_LABELS[s]}</div>
            <div className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">{counts[s]}</div>
          </button>
        ))}
      </div>

      {activeSegment && (
        <button type="button" onClick={() => setActiveSegment(null)} className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          Clear filter ({SEGMENT_LABELS[activeSegment]})
        </button>
      )}

      {!customers ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Customer</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Country</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Orders</th>
                <th className="px-4 py-2 text-right font-medium text-zinc-500">Total Value</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Last Order</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Segments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">
                    <a href={`/masters/customers/${c.id}/360`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                      {c.name}
                    </a>{" "}
                    <span className="text-xs text-zinc-400">({c.code})</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{c.country ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">{c.orderCount}</td>
                  <td className="px-4 py-2 text-right text-zinc-700 dark:text-zinc-300">₹{c.totalOrderValue.toLocaleString()}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                    {c.lastOrderDate ? `${new Date(c.lastOrderDate).toLocaleDateString()} (${c.daysSinceLastOrder}d ago)` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.segments.map((s) => (
                        <span key={s} className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT_BADGE_CLASS[s]}`}>
                          {SEGMENT_LABELS[s]}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    No customers in this segment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">By Product Category</h2>
        {!categories ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-zinc-500">No confirmed order lines yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((cat) => (
              <li key={cat.categoryId} className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="font-medium text-zinc-900 dark:text-zinc-50">{cat.categoryName}</div>
                <div className="text-xs text-zinc-500">
                  {cat.customerCount} customer{cat.customerCount === 1 ? "" : "s"} · {cat.orderCount} order{cat.orderCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

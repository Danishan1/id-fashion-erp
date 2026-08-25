import { registerReportPageMeta } from "../report-page-meta";
import type { ReportDescriptor } from "@/core/reports/report-types";

function renderKpiCards(descriptor: ReportDescriptor) {
  const sections = new Map<string, { metric: string; value: string }[]>();
  for (const row of descriptor.rows) {
    const section = String(row.section);
    const list = sections.get(section) ?? [];
    list.push({ metric: String(row.metric), value: String(row.value) });
    sections.set(section, list);
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[...sections.entries()].map(([section, metrics]) => (
        <div key={section} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{section}</h3>
          <dl className="space-y-1">
            {metrics.map((m) => (
              <div key={m.metric} className="flex items-center justify-between text-xs">
                <dt className="text-zinc-500 dark:text-zinc-400">{m.metric}</dt>
                <dd className="font-medium text-zinc-800 dark:text-zinc-200">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

registerReportPageMeta({
  category: "dashboard",
  key: "executive-dashboard",
  title: "Executive Dashboard",
  description: "Company-wide KPI snapshot — every figure reconciles with its own module's register report.",
  includeDateRange: false,
  renderKpis: renderKpiCards,
});

registerReportPageMeta({
  category: "mis",
  key: "daily-mis",
  title: "Management MIS — Daily",
  description: "Daily management information summary.",
  includeDateRange: false,
  filterFields: [{ key: "date", label: "Date", type: "date" }],
  renderKpis: renderKpiCards,
});

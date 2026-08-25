"use client";

import { useParams } from "next/navigation";
import { ReportPage } from "@/components/reports/ReportPage";
import { getReportPageMeta } from "@/modules/reports/report-page-meta";
import "@/modules/reports/all-report-page-meta";
import { REPORT_CATEGORIES_META } from "@/modules/reports/categories-meta";

export default function ReportDetailPage() {
  const params = useParams<{ category: string; report: string }>();
  const meta = getReportPageMeta(params.category, params.report);
  const categoryMeta = REPORT_CATEGORIES_META.find((c) => c.key === params.category);

  if (!meta) {
    return <p className="text-sm text-red-600 dark:text-red-400">Report not found.</p>;
  }

  return (
    <ReportPage
      title={meta.title}
      description={meta.description}
      breadcrumb={[
        { label: "Dashboard", href: "/dashboard" },
        { label: "Report Center", href: "/reports" },
        { label: categoryMeta?.label ?? params.category, href: `/reports/${params.category}` },
        { label: meta.title },
      ]}
      apiPath={`/api/v1/reports/${params.category}/${params.report}`}
      filterFields={meta.filterFields}
      includeDateRange={meta.includeDateRange ?? true}
      defaultFilters={meta.defaultFilters}
      linkBuilders={meta.linkBuilders}
      renderKpis={meta.renderKpis}
    />
  );
}

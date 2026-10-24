"use client";

import Link from "next/link";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SimpleLookupManager } from "@/components/ui/SimpleLookupManager";

/**
 * Leave policy per type (old LeavePolicy): a quota credited at the start of
 * every allocation period. Unused quota carries forward month to month; the
 * balances themselves live on the Leave Balances page.
 */
export function LeaveTypesClient() {
  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Leave Types" }]} />
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Leave Types</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Each leave type gives every employee a quota at the start of its period — monthly, quarterly, half-yearly or yearly. Unused quota carries forward to the next month. See and adjust each employee&apos;s balance on{" "}
          <Link href="/leave-balances" className="font-medium text-indigo-600 hover:text-indigo-500">
            Leave Balances
          </Link>
          .
        </p>
      </div>
      <SimpleLookupManager
        fetchUrl="/api/v1/leave-types"
        entityLabel="Leave Type"
        fields={[
          { key: "name", label: "Name", required: true },
          {
            key: "allocationType",
            label: "Credited",
            type: "select",
            required: true,
            options: [
              { value: "MONTHLY", label: "Every month" },
              { value: "QUARTERLY", label: "Every quarter (Jan/Apr/Jul/Oct)" },
              { value: "HALF_YEARLY", label: "Every half-year (Jan/Jul)" },
              { value: "YEARLY", label: "Every year (January)" },
            ],
          },
          { key: "quotaPerPeriod", label: "Days per period", type: "number", required: true },
        ]}
      />
    </div>
  );
}

import Link from "next/link";
import { CrmPageHeader } from "@/components/crm/CrmPageHeader";
import { CrmEmptyState } from "@/components/crm/CrmStates";
import { CrmTimeline } from "@/components/crm/CrmTimeline";

/**
 * CRM Dashboard — Phase 01 shell (Leads link added in Phase 02). KPIs and widgets are added in Phase 32 from
 * real data; until CRM records exist this page only shows the live activity
 * feed, so it never displays numbers that aren't backed by records.
 */
export default function CrmDashboardPage() {
  return (
    <>
      <CrmPageHeader title="CRM Dashboard" description="Your sales relationships, pipeline and follow-ups in one place." />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-zinc-200 p-4 lg:col-span-2 dark:border-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent activity</h2>
            <Link href="/crm/activity" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
              View activity log →
            </Link>
          </div>
          <CrmTimeline pageSize={10} />
        </section>

        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Pipeline summary</h2>
          <CrmEmptyState
            title="Pipeline summary comes with pipelines"
            description="Leads are live now. Pipeline stages and totals are added in a later CRM phase, so no numbers are shown here yet."
            action={
              <Link href="/crm/leads" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                Go to leads →
              </Link>
            }
          />
        </section>
      </div>
    </>
  );
}

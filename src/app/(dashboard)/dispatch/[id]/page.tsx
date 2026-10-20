import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getDispatchById } from "@/modules/dispatch/dispatch.service";
import { DispatchWorkflowPanel } from "./DispatchWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const dispatch = await getDispatchById({ companyId: session!.user.companyId, userId: session!.user.id }, id).catch(() => null);
  if (!dispatch) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Breadcrumb
            items={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Dispatch", href: "/dispatch" },
              { label: dispatch.dispatchNumber },
            ]}
          />
          <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{dispatch.dispatchNumber}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/v1/dispatches/${id}/pdf`}
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Delivery Challan PDF
          </a>
          <a
            href={`/api/v1/dispatches/${id}/pdf?type=packing-list`}
            className="whitespace-nowrap rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Packing List PDF
          </a>
        </div>
      </div>

      <DispatchWorkflowPanel key={id} dispatch={JSON.parse(JSON.stringify(dispatch))} />
    </div>
  );
}

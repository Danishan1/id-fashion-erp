import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { getDispatchById } from "@/modules/dispatch/dispatch.service";
import { DispatchWorkflowPanel } from "./DispatchWorkflowPanel";
import { Breadcrumb } from "@/components/ui/Breadcrumb";

export default async function DispatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  const dispatch = await getDispatchById(session!.user.companyId, id).catch(() => null);
  if (!dispatch) notFound();

  return (
    <div className="space-y-6">
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

      <DispatchWorkflowPanel key={id} dispatch={JSON.parse(JSON.stringify(dispatch))} />
    </div>
  );
}

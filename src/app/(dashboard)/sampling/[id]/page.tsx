import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { SampleWorkflowPanel } from "../SampleWorkflowPanel";
import { SAMPLE_TYPE_LABELS } from "../sampleTypeLabels";

export default async function SampleRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  // Confirmed pre-existing gap (found during a Phase-8/9-era QA pass): this
  // page called the service directly with no permission check at all,
  // unlike GET /api/v1/sampling/[id], which correctly gates on "view".
  await PermissionService.assert(session!.user.id, "sampling", "view").catch(() => notFound());

  const request = await getSampleRequestById(session!.user.companyId, id).catch(() => null);
  if (!request) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sampling", href: "/sampling" }, { label: request.requestNumber }]} />
        <h1 className="mt-2 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {request.requestNumber} — {request.styleName ?? request.product?.styleName}
          <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {request.sampleType
              ? SAMPLE_TYPE_LABELS[request.sampleType as keyof typeof SAMPLE_TYPE_LABELS]
              : "Not specified"}
          </span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {request.customer.name}
          {request.buyer ? ` — ${request.buyer.name}` : ""} · Requested by {request.requestedBy.fullName} on{" "}
          {new Date(request.requestDate).toLocaleDateString()}
          {request.targetSubmissionDate ? ` · Target: ${new Date(request.targetSubmissionDate).toLocaleDateString()}` : ""}
        </p>
      </div>

      {/* Prisma Decimal/Date instances aren't plain-serializable across the
          server/client boundary — round-trip through JSON to get plain
          strings before handing this to the client component. `key={id}`
          forces a full remount when navigating between two different sample
          requests client-side — without it, React reuses the same component
          instance and its `useState(initialRequest)` never re-initializes,
          so the panel can keep showing the *previous* sample's data (wrong
          productId, wrong versions) under the new URL. */}
      <SampleWorkflowPanel key={id} sampleRequestId={id} initialRequest={JSON.parse(JSON.stringify(request))} />
    </div>
  );
}

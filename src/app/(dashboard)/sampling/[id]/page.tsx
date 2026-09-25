import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { getSampleRequestById } from "@/modules/sampling/sample.service";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { formatDate } from "@/lib/date-format";
import { SampleWorkflowPanel } from "../SampleWorkflowPanel";
import { SAMPLE_TYPE_LABELS } from "../sampleTypeLabels";

export default async function SampleRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  // Confirmed pre-existing gap (found during a Phase-8/9-era QA pass): this
  // page called the service directly with no permission check at all,
  // unlike GET /api/v1/sampling/[id], which correctly gates on "view".
  await PermissionService.assert(session!.user.id, "sampling", "view", { sessionIssuedAt: session!.user.sessionIssuedAt }).catch(() => notFound());

  const request = await getSampleRequestById(session!.user.companyId, id).catch(() => null);
  if (!request) notFound();

  // Drives whether the Internal QC action buttons render or show an
  // explanatory message instead (RBAC audit, 2026-09-24) — real enforcement
  // is entirely server-side in transitionSampleStatus(), this is purely so
  // a Merchandiser doesn't see a button that would 403 on click.
  const canQcEdit = await PermissionService.can(session!.user.id, "qc", "edit");
  // Same discipline, extended to every other mutation this panel offers
  // (2026-09-24 — QC_MANAGER has sampling:view only, so every one of these
  // "edit"/"approve"/"reject"-gated buttons was previously a dead end for
  // them). MANAGEMENT holds approve+reject but NOT edit; MERCHANDISER holds
  // edit but NOT approve/reject — genuinely disjoint grants (confirmed
  // against src/config/rbac.ts), so these stay four separate booleans
  // rather than being folded into one.
  const canSamplingEdit = await PermissionService.can(session!.user.id, "sampling", "edit");
  const canSamplingApprove = await PermissionService.can(session!.user.id, "sampling", "approve");
  const canSamplingReject = await PermissionService.can(session!.user.id, "sampling", "reject");
  const canGenerateMaterialRequest = await PermissionService.can(session!.user.id, "material_request", "create");
  // "approve" is self-approval-guarded (SELF_APPROVAL_GUARDED_ACTIONS) —
  // canSamplingApprove above is a blanket "does this role hold approve at
  // all" check, correct for Lock/Unlock Costing (not self-approval-guarded)
  // but WRONG for any action that actually checks resourceContext.createdBy
  // server-side (fastTrackApproveSample, and the "Approved" outcome of
  // recordSampleApproval) — a request's own creator would see the button,
  // then get a confusing 403 on submit (2026-09-25, found live: the same
  // account both copied a design and then tried to fast-track-approve it).
  // This mirrors the exact server-side check for THIS specific request.
  const canApproveThisSample = await PermissionService.can(session!.user.id, "sampling", "approve", {
    createdBy: request.requestedByUserId,
  });

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
          {formatDate(request.requestDate)}
          {request.targetSubmissionDate ? ` · Target: ${formatDate(request.targetSubmissionDate)}` : ""}
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
      <SampleWorkflowPanel
        key={id}
        sampleRequestId={id}
        initialRequest={JSON.parse(JSON.stringify(request))}
        canQcEdit={canQcEdit}
        canSamplingEdit={canSamplingEdit}
        canSamplingApprove={canSamplingApprove}
        canSamplingReject={canSamplingReject}
        canApproveThisSample={canApproveThisSample}
        canGenerateMaterialRequest={canGenerateMaterialRequest}
      />
    </div>
  );
}

import { notFound } from "next/navigation";
import { auth } from "@/core/auth/auth";
import { PermissionService } from "@/core/rbac/PermissionService";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { getPaymentRequestById } from "@/modules/accounts/payment-requests/payment-request.service";
import { getApproverIdentity, isListedApprover } from "@/modules/accounts/payment-requests/approval-matrix.service";
import { canBePaidYet, mayPayAfterApproving } from "@/modules/accounts/payment-requests/payout.service";
import { PaymentRequestWorkflowPanel } from "./PaymentRequestWorkflowPanel";

export default async function PaymentRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;
  await PermissionService.assert(userId, "payment_requests", "view").catch(() => notFound());

  const request = await getPaymentRequestById({ companyId: session!.user.companyId, userId }, id).catch(() => null);
  if (!request) notFound();

  const isRaiser = request.createdByUserId === userId;
  const unpaid = Number(request.paidAmount) === 0;
  const [canApprove, canReject, canEditOthers, canCancelOthers, canCreate, canPost] = await Promise.all([
    // Passing createdBy applies the self-approval guard, so the raiser never sees Approve.
    PermissionService.can(userId, "payment_requests", "approve", { createdBy: request.createdByUserId }),
    PermissionService.can(userId, "payment_requests", "reject"),
    PermissionService.can(userId, "payment_requests", "edit"),
    PermissionService.can(userId, "payment_requests", "cancel"),
    PermissionService.can(userId, "payment_requests", "create"),
    // createdBy: the raiser can never pay their own request.
    PermissionService.can(userId, "payment_requests", "post", { createdBy: request.createdByUserId }),
  ]);
  const approvedByMe = request.approvals.some((a) => a.userId === userId && a.decision === "APPROVED");
  const payable = request.status === "APPROVED" || request.status === "PARTIALLY_PAID";
  const mayPay = payable && (await mayPayAfterApproving(userId, request));
  const pending = request.status === "PENDING_APPROVAL";
  // Approval Matrix: only the current level's approvers, never twice on one request.
  const identity = await getApproverIdentity(userId);
  const decidesThisLevel =
    pending &&
    isListedApprover(request, userId, identity) &&
    !approvedByMe;

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb
          items={[
            { label: "Accounts", href: "/accounts" },
            { label: "Payment Requests", href: "/accounts/payment-requests" },
            { label: request.requestNumber },
          ]}
        />
        <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{request.requestNumber}</h1>
      </div>

      <PaymentRequestWorkflowPanel
        key={id}
        request={JSON.parse(JSON.stringify(request))}
        permissions={{
          canApprove: decidesThisLevel && canApprove,
          canReject: decidesThisLevel && canReject,
          canEdit: pending && request.approvals.length === 0 && (isRaiser || canEditOthers),
          canCancel:
            (pending || request.status === "APPROVED") && unpaid && (isRaiser || canCancelOthers),
          canPay: payable && canPost && canBePaidYet(request.requestType) && mayPay,
          payNotAvailableYet: payable && !canBePaidYet(request.requestType),
          canEditFiles: canCreate && request.status !== "CANCELLED" && request.status !== "REJECTED",
        }}
      />
    </div>
  );
}

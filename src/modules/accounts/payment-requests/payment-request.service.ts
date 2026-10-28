import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import { todayIsoDate } from "@/lib/date";
import { round2 } from "@/lib/money";
import type { ListQuery } from "@/lib/list-query";
import { PaymentRequestStatus, type Prisma } from "@prisma/client";
import { createNotification } from "@/core/notifications/NotificationService";
import { logger } from "@/core/logging/logger";
import { PaymentRequestRepository } from "./payment-request.repository";
import { ApprovalMatrixRepository } from "./approval-matrix.repository";
import {
  currentLevelColumns,
  getApproverIdentity,
  isListedApprover,
  planColumns,
  resolveApprovalPlan,
  type ApprovalPlan,
} from "./approval-matrix.service";
import type {
  CreatePaymentRequestInput,
  PaymentRequestListFilters,
  UpdatePaymentRequestInput,
} from "./payment-request.schema";
import {
  PAYMENT_REQUEST_TYPE_DEFS,
  isPaymentRequestOverdue,
  type PaymentRequestTypeDef,
} from "./request-type-registry";

/**
 * Payments Request hub — foundation (2026-10-27). A request is raised, then
 * approved/rejected (or routed straight to the accountant), then paid. Paying
 * lives in the payout skill (payment-request-accountant-payout); this file
 * owns the request itself: create, edit, approve, reject, cancel, list.
 *
 * Who sees what: a user with view_all, approve or post sees every request
 * (approvers and accountants need the whole queue); anyone else sees only the
 * requests they raised. Branch scope applies on top, as everywhere else.
 */

interface ActorContext {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

const EDITABLE_STATUSES: PaymentRequestStatus[] = ["PENDING_APPROVAL"];
const CANCELLABLE_STATUSES: PaymentRequestStatus[] = ["PENDING_APPROVAL", "APPROVED"];
const VALID_STATUSES = new Set<string>(Object.values(PaymentRequestStatus));

async function canSeeAllRequests(userId: string): Promise<boolean> {
  for (const action of ["view_all", "approve", "post"] as const) {
    if (await PermissionService.can(userId, "payment_requests", action)) return true;
  }
  return false;
}

function notFound(id: string): never {
  throw new BusinessRuleError("NOT_FOUND", "Payment request not found.", { id });
}

/** Resolves the pay-to for the type: a real supplier / employee, or a typed name. */
async function resolvePayTo(companyId: string, def: PaymentRequestTypeDef, input: UpdatePaymentRequestInput) {
  if (def.payTo === "SUPPLIER") {
    if (!input.supplierId) throw new BusinessRuleError("VALIDATION_ERROR", `${def.payToLabel} is required.`, { field: "supplierId" });
    const supplier = await PaymentRequestRepository.findActiveSupplier(companyId, input.supplierId);
    if (!supplier) throw new BusinessRuleError("NOT_FOUND", "Supplier not found or inactive.", { id: input.supplierId });
    return { payToName: supplier.name, supplierId: supplier.id, employeeId: null, payeeId: null };
  }
  if (def.payTo === "EMPLOYEE") {
    if (!input.employeeId) throw new BusinessRuleError("VALIDATION_ERROR", `${def.payToLabel} is required.`, { field: "employeeId" });
    const employee = await PaymentRequestRepository.findActiveEmployee(companyId, input.employeeId);
    if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found or inactive.", { id: input.employeeId });
    return { payToName: employee.fullName, supplierId: null, employeeId: employee.id, payeeId: null };
  }
  // A typed name, or a pick from the Payee master (then the payee's own name is used).
  if (input.payeeId) {
    const payee = await PaymentRequestRepository.findActivePayee(companyId, input.payeeId);
    if (!payee) throw new BusinessRuleError("NOT_FOUND", "Payee not found or inactive.", { id: input.payeeId });
    return { payToName: payee.name, supplierId: null, employeeId: null, payeeId: payee.id };
  }
  const name = input.payToName?.trim();
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", `${def.payToLabel} is required.`, { field: "payToName" });
  return { payToName: name, supplierId: null, employeeId: null, payeeId: null };
}

/** `currentDueDate`: on edit, an omitted due date keeps the existing one instead of resetting to today. */
function buildCommonData(def: PaymentRequestTypeDef, input: UpdatePaymentRequestInput, currentDueDate?: Date) {
  return {
    amount: round2(input.amount),
    paymentDueDate: input.paymentDueDate ? new Date(input.paymentDueDate) : (currentDueDate ?? new Date(todayIsoDate())),
    modeOfTransfer: def.showModeOfTransfer && input.modeOfTransfer ? input.modeOfTransfer : null,
    remark: input.remark?.trim() || null,
  };
}

function withOverdue<T extends { status: string; paymentDueDate: Date }>(row: T) {
  return { ...row, isOverdue: isPaymentRequestOverdue(row.status, row.paymentDueDate.toISOString(), todayIsoDate()) };
}

async function visibilityWhere(userId: string): Promise<Prisma.PaymentRequestWhereInput> {
  const allowedBranchIds = await PermissionService.getAllowedBranchIds(userId);
  const seeAll = await canSeeAllRequests(userId);
  return { ...branchScopeWhere(allowedBranchIds), ...(seeAll ? {} : { createdByUserId: userId }) };
}

export async function listPaymentRequests(actor: ActorContext, query: ListQuery, filters: PaymentRequestListFilters) {
  const where: Prisma.PaymentRequestWhereInput = {
    companyId: actor.companyId,
    ...(await visibilityWhere(actor.userId)),
    ...(filters.group ? { requestGroup: filters.group } : {}),
    ...(filters.requestType ? { requestType: filters.requestType } : {}),
    ...(query.status && VALID_STATUSES.has(query.status) ? { status: query.status as PaymentRequestStatus } : {}),
    ...(query.search
      ? {
          OR: [
            { requestNumber: { contains: query.search, mode: "insensitive" as const } },
            { payToName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  if (filters.view === "mine") where.createdByUserId = actor.userId;
  if (filters.view === "approve") {
    // Waiting for me: pending, not raised by me, I'm an approver of its current
    // level and I haven't approved an earlier level of it.
    const identity = await getApproverIdentity(actor.userId);
    where.status = "PENDING_APPROVAL";
    where.createdByUserId = { not: actor.userId };
    where.approvals = { none: { userId: actor.userId, decision: "APPROVED" } };
    if (!identity.isSuperAdmin) {
      where.AND = [
        {
          OR: [
            { currentLevelAnyApprover: true },
            { currentApproverUserIds: { has: actor.userId } },
            ...(identity.roleIds.length ? [{ currentApproverRoleIds: { hasSome: identity.roleIds } }] : []),
          ],
        },
      ];
    }
  }
  if (filters.view === "pay") where.status = { in: ["APPROVED", "PARTIALLY_PAID"] };

  const sortable = new Set(["requestNumber", "amount", "paymentDueDate", "createdAt", "status", "payToName"]);
  const orderBy = { [sortable.has(query.sortBy) ? query.sortBy : "createdAt"]: query.sortOrder };

  const [rows, totalCount] = await Promise.all([
    PaymentRequestRepository.findMany(where, { orderBy, skip: query.skip, take: query.take }),
    PaymentRequestRepository.count(where),
  ]);
  return { data: rows.map(withOverdue), totalCount };
}

/** Counts per group and status, for the hub's tabs — only requests the actor can see. */
export async function getPaymentRequestSummary(actor: ActorContext) {
  const rows = await PaymentRequestRepository.countByGroupAndStatus({
    companyId: actor.companyId,
    ...(await visibilityWhere(actor.userId)),
  });
  return rows.map((r) => ({ group: r.requestGroup, status: r.status, count: r._count._all }));
}

/** Not-found (never "forbidden") for a request outside the actor's branch or, without view_all, someone else's. */
export async function getPaymentRequestById(actor: ActorContext, id: string) {
  const request = await PaymentRequestRepository.findByIdWithDetails(actor.companyId, id);
  if (!request) notFound(id);

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!request.branchId || !allowedBranchIds.has(request.branchId))) notFound(id);
  if (request.createdByUserId !== actor.userId && !(await canSeeAllRequests(actor.userId))) notFound(id);

  return withOverdue(request);
}

export async function createPaymentRequest(actor: ActorContext, input: CreatePaymentRequestInput) {
  if (input.idempotencyKey) {
    const existing = await PaymentRequestRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
    if (existing) return withOverdue(existing);
  }

  const def = PAYMENT_REQUEST_TYPE_DEFS[input.requestType];
  if (!def.available) {
    throw new BusinessRuleError("VALIDATION_ERROR", `"${def.label}" is not available yet.`, { requestType: input.requestType });
  }

  const payTo = await resolvePayTo(actor.companyId, def, input);
  const company = await PaymentRequestRepository.findBaseCurrencyCode(actor.companyId);
  if (!company) throw new BusinessRuleError("NOT_FOUND", "Company not found.", { id: actor.companyId });

  const common = buildCommonData(def, input);
  const plan = await resolveApprovalPlan(actor.companyId, def.type, actor.branchId ?? null, common.amount);
  // Company-wide series (branchId null): request numbers are unique per company.
  const requestNumber = await generateDocumentNumber({ companyId: actor.companyId, branchId: null, documentType: "PAYMENT_REQUEST" });

  let created;
  try {
    created = await PaymentRequestRepository.create({
      companyId: actor.companyId,
      branchId: actor.branchId ?? null,
      requestNumber,
      requestType: def.type,
      requestGroup: def.group,
      ...planColumns(plan),
      currencyCode: company.baseCurrencyCode,
      ...payTo,
      ...common,
      createdByUserId: actor.userId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  } catch (err) {
    if (input.idempotencyKey && err && typeof err === "object" && "code" in err && err.code === "P2002") {
      const existing = await PaymentRequestRepository.findByIdempotencyKey(actor.companyId, input.idempotencyKey);
      if (existing) return withOverdue(existing);
    }
    throw err;
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: created.id,
    action: "CREATE",
    newValues: {
      requestNumber,
      requestType: def.type,
      amount: created.amount,
      payToName: created.payToName,
      status: created.status,
      approvalRuleId: plan.ruleId,
    },
  });

  await notifyCurrentApprovers(actor.companyId, created.id, requestNumber, plan, 1, actor.userId);
  return getPaymentRequestById(actor, created.id);
}

/**
 * Only while PENDING_APPROVAL and before anyone has approved a level (an
 * approver must never have approved a different amount). The raiser can edit
 * their own; anyone else needs payment_requests.edit. The approval plan is
 * worked out again, since a new amount can fall in another slab.
 */
export async function updatePaymentRequest(actor: ActorContext, id: string, input: UpdatePaymentRequestInput) {
  const request = await getPaymentRequestById(actor, id);
  if (request.createdByUserId !== actor.userId) await PermissionService.assert(actor.userId, "payment_requests", "edit");
  if (request.approvals.length > 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This request already has an approval; it can no longer be edited.", {
      currentStatus: request.status,
    });
  }

  const def = PAYMENT_REQUEST_TYPE_DEFS[request.requestType];
  const payTo = await resolvePayTo(actor.companyId, def, input);
  const common = buildCommonData(def, input, request.paymentDueDate);
  const plan = await resolveApprovalPlan(actor.companyId, request.requestType, request.branchId, common.amount);
  const data = { ...payTo, ...common, ...planColumns(plan) };

  const { count } = await PaymentRequestRepository.updateIfStatus(id, EDITABLE_STATUSES, data);
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `A request can be edited only while it is pending approval.`, {
      currentStatus: request.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "UPDATE",
    oldValues: { amount: request.amount, payToName: request.payToName, paymentDueDate: request.paymentDueDate, remark: request.remark },
    newValues: data,
  });

  return getPaymentRequestById(actor, id);
}

/**
 * The actor may decide the request's current level: it is pending, the actor
 * is one of that level's approvers in the Approval Matrix (or the level has no
 * rule and they hold the permission), and they haven't approved an earlier
 * level already. Throws a clear error otherwise.
 */
async function assertCanDecideCurrentLevel(actor: ActorContext, request: Awaited<ReturnType<typeof getPaymentRequestById>>) {
  if (request.status !== "PENDING_APPROVAL") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot decide a request in "${request.status}" status.`, {
      currentStatus: request.status,
    });
  }
  const identity = await getApproverIdentity(actor.userId);
  if (!isListedApprover(request, actor.userId, identity)) {
    throw new BusinessRuleError(
      "PERMISSION_DENIED",
      `You are not an approver for level ${request.currentApprovalLevel} of this request in the Approval Matrix.`
    );
  }
  if (await PaymentRequestRepository.hasApproved(request.id, actor.userId)) {
    throw new BusinessRuleError("PERMISSION_DENIED", "You already approved an earlier level of this request; another approver must decide this level.");
  }
}

/**
 * Approves the current level. The last level makes the request APPROVED (ready
 * to pay); an earlier level moves it to the next level's approvers. The raiser
 * can never approve their own request (self-approval guard).
 */
export async function approvePaymentRequest(actor: ActorContext, id: string, remark?: string) {
  const request = await getPaymentRequestById(actor, id);
  await PermissionService.assert(actor.userId, "payment_requests", "approve", { createdBy: request.createdByUserId });
  await assertCanDecideCurrentLevel(actor, request);

  const level = request.currentApprovalLevel;
  const plan = request.approvalPlanJson as unknown as ApprovalPlan | null;
  const isLast = !plan || level >= request.requiredApprovalLevels;
  const data = isLast
    ? { status: "APPROVED" as const, approvedAt: new Date(), approvedByUserId: actor.userId }
    : currentLevelColumns(plan, level + 1);

  const ok = await PaymentRequestRepository.recordDecision(
    id,
    level,
    { decision: "APPROVED", userId: actor.userId, remark: remark?.trim() || null },
    data
  );
  if (!ok) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This level was already decided by someone else. Reload the request.", {
      currentStatus: request.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: request.status, level },
    newValues: isLast ? { status: "APPROVED", level } : { status: "PENDING_APPROVAL", level: level + 1 },
  });

  if (isLast) {
    await notifyUsers(actor.companyId, [request.createdByUserId], id, `${request.requestNumber} approved`, `Your payment request for ₹${request.amount} to ${request.payToName} is approved and waiting to be paid.`);
  } else {
    await notifyCurrentApprovers(actor.companyId, id, request.requestNumber, plan, level + 1, request.createdByUserId);
  }

  return getPaymentRequestById(actor, id);
}

/** Any level can reject: PENDING_APPROVAL -> REJECTED (terminal). A reason is required. */
export async function rejectPaymentRequest(actor: ActorContext, id: string, rejectionReason: string) {
  const request = await getPaymentRequestById(actor, id);
  await PermissionService.assert(actor.userId, "payment_requests", "reject");
  await assertCanDecideCurrentLevel(actor, request);

  const ok = await PaymentRequestRepository.recordDecision(
    id,
    request.currentApprovalLevel,
    { decision: "REJECTED", userId: actor.userId, remark: rejectionReason },
    { status: "REJECTED", rejectedAt: new Date(), rejectedByUserId: actor.userId, rejectionReason }
  );
  if (!ok) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot reject a request in "${request.status}" status.`, {
      currentStatus: request.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "REJECT",
    oldValues: { status: request.status },
    newValues: { status: "REJECTED", rejectionReason, level: request.currentApprovalLevel },
  });

  await notifyUsers(actor.companyId, [request.createdByUserId], id, `${request.requestNumber} rejected`, `Your payment request to ${request.payToName} was rejected: ${rejectionReason}`);
  return getPaymentRequestById(actor, id);
}

// ─── Notifications (in-app, best effort — never block the decision) ─────

async function notifyUsers(companyId: string, userIds: string[], requestId: string, title: string, body: string) {
  try {
    for (const userId of userIds.slice(0, 50)) {
      await createNotification({ companyId, userId, title, body, relatedModule: "PAYMENT_REQUEST", relatedRecordId: requestId });
    }
  } catch (err) {
    logger.warn("Payment request notification failed", { requestId, error: err });
  }
}

/** Tells the named approvers of `level` (users + holders of the roles) that a request waits for them. */
async function notifyCurrentApprovers(
  companyId: string,
  requestId: string,
  requestNumber: string,
  plan: ApprovalPlan | null,
  level: number,
  excludeUserId: string
) {
  const at = plan?.levels.find((l) => l.level === level);
  if (!at || at.anyApprover) return;
  const userIds = await ApprovalMatrixRepository.findApproverUserIds(
    companyId,
    at.users.map((u) => u.id),
    at.roles.map((r) => r.id)
  );
  await notifyUsers(
    companyId,
    userIds.filter((u) => u !== excludeUserId),
    requestId,
    `${requestNumber} needs your approval`,
    `Payment request ${requestNumber} is waiting for level ${level} approval.`
  );
}

/** Before any money is paid. The raiser can cancel their own; anyone else needs payment_requests.cancel. */
export async function cancelPaymentRequest(actor: ActorContext, id: string) {
  const request = await getPaymentRequestById(actor, id);
  if (request.createdByUserId !== actor.userId) await PermissionService.assert(actor.userId, "payment_requests", "cancel");

  const { count } = await PaymentRequestRepository.updateIfStatus(id, CANCELLABLE_STATUSES, {
    status: "CANCELLED",
    cancelledAt: new Date(),
    cancelledByUserId: actor.userId,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot cancel a request in "${request.status}" status or once paid.`, {
      currentStatus: request.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "CANCEL",
    oldValues: { status: request.status },
    newValues: { status: "CANCELLED" },
  });

  return getPaymentRequestById(actor, id);
}

/** For the attachments API: throws NOT_FOUND unless the actor may see this request. */
export async function assertPaymentRequestVisible(actor: ActorContext, id: string) {
  await getPaymentRequestById(actor, id);
}

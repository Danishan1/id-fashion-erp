import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { generateDocumentNumber } from "@/core/numbering/DocumentNumberingService";
import { PermissionService } from "@/core/rbac/PermissionService";
import { branchScopeWhere } from "@/lib/branch-access";
import { todayIsoDate } from "@/lib/date";
import { round2 } from "@/lib/money";
import type { ListQuery } from "@/lib/list-query";
import { PaymentRequestStatus, type Prisma } from "@prisma/client";
import { PaymentRequestRepository } from "./payment-request.repository";
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
    return { payToName: supplier.name, supplierId: supplier.id, employeeId: null };
  }
  if (def.payTo === "EMPLOYEE") {
    if (!input.employeeId) throw new BusinessRuleError("VALIDATION_ERROR", `${def.payToLabel} is required.`, { field: "employeeId" });
    const employee = await PaymentRequestRepository.findActiveEmployee(companyId, input.employeeId);
    if (!employee) throw new BusinessRuleError("NOT_FOUND", "Employee not found or inactive.", { id: input.employeeId });
    return { payToName: employee.fullName, supplierId: null, employeeId: employee.id };
  }
  const name = input.payToName?.trim();
  if (!name) throw new BusinessRuleError("VALIDATION_ERROR", `${def.payToLabel} is required.`, { field: "payToName" });
  return { payToName: name, supplierId: null, employeeId: null };
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
  if (filters.view === "approve") where.status = "PENDING_APPROVAL";
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

  const direct = def.routing === "DIRECT_TO_ACCOUNTANT";
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
      routing: def.routing,
      status: direct ? "APPROVED" : "PENDING_APPROVAL",
      currencyCode: company.baseCurrencyCode,
      ...payTo,
      ...buildCommonData(def, input),
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
    newValues: { requestNumber, requestType: def.type, amount: created.amount, payToName: created.payToName, status: created.status },
  });

  return getPaymentRequestById(actor, created.id);
}

/** Only while PENDING_APPROVAL. The raiser can edit their own; anyone else needs payment_requests.edit. */
export async function updatePaymentRequest(actor: ActorContext, id: string, input: UpdatePaymentRequestInput) {
  const request = await getPaymentRequestById(actor, id);
  if (request.createdByUserId !== actor.userId) await PermissionService.assert(actor.userId, "payment_requests", "edit");

  const def = PAYMENT_REQUEST_TYPE_DEFS[request.requestType];
  const payTo = await resolvePayTo(actor.companyId, def, input);
  const data = { ...payTo, ...buildCommonData(def, input, request.paymentDueDate) };

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

/** PENDING_APPROVAL -> APPROVED. The raiser can never approve their own request (self-approval guard). */
export async function approvePaymentRequest(actor: ActorContext, id: string) {
  const request = await getPaymentRequestById(actor, id);
  await PermissionService.assert(actor.userId, "payment_requests", "approve", { createdBy: request.createdByUserId });

  const { count } = await PaymentRequestRepository.updateIfStatus(id, ["PENDING_APPROVAL"], {
    status: "APPROVED",
    approvedAt: new Date(),
    approvedByUserId: actor.userId,
  });
  if (count === 0) {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", `Cannot approve a request in "${request.status}" status.`, {
      currentStatus: request.status,
    });
  }

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "payment_requests",
    recordId: id,
    action: "APPROVE",
    oldValues: { status: request.status },
    newValues: { status: "APPROVED" },
  });

  return getPaymentRequestById(actor, id);
}

/** PENDING_APPROVAL -> REJECTED (terminal). A reason is required. */
export async function rejectPaymentRequest(actor: ActorContext, id: string, rejectionReason: string) {
  const request = await getPaymentRequestById(actor, id);
  await PermissionService.assert(actor.userId, "payment_requests", "reject");

  const { count } = await PaymentRequestRepository.updateIfStatus(id, ["PENDING_APPROVAL"], {
    status: "REJECTED",
    rejectedAt: new Date(),
    rejectedByUserId: actor.userId,
    rejectionReason,
  });
  if (count === 0) {
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
    newValues: { status: "REJECTED", rejectionReason },
  });

  return getPaymentRequestById(actor, id);
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

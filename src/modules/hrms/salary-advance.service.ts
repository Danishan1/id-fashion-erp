import type { PaymentRequestStatus, Prisma } from "@prisma/client";
import { writeAuditLog } from "@/core/audit/AuditLogger";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { round2 } from "./attendance-calculator";
import { cancelPaymentRequest, createPaymentRequest } from "@/modules/accounts/payment-requests/payment-request.service";
import type { RequestSalaryAdvanceInput } from "./salary-advance.schema";

/**
 * Salary Management slice 5 (2026-10-28, docs/hrms/SALARY_MANAGEMENT_PLAN.md):
 * Advance Salary. Only the employee raises it (for themselves). It becomes a
 * SALARY_ADVANCE payment request — Accounts → Expenditure Payment, approval
 * matrix, accountant payout (Dr Salary Advance / Cr Bank). Once paid, each
 * salary run takes up to one installment until it is recovered.
 *
 * Status is never stored: it comes from the payment request and the
 * recoveries (hrms_salary_advance_recoveries, written at salary finalise).
 */

const MODULE = "hrms_salary_advance" as const;

export interface SalaryAdvanceActor {
  companyId: string;
  userId: string;
  branchId?: string | null;
}

export type SalaryAdvanceStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "CANCELLED" | "RECOVERING" | "RECOVERED";

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

export function deriveAdvanceStatus(prStatus: PaymentRequestStatus, amount: number, recovered: number): SalaryAdvanceStatus {
  switch (prStatus) {
    case "PENDING_APPROVAL":
      return "PENDING_APPROVAL";
    case "REJECTED":
      return "REJECTED";
    case "CANCELLED":
      return "CANCELLED";
    case "PAID":
      return recovered + 0.005 >= amount ? "RECOVERED" : "RECOVERING";
    default:
      return "APPROVED"; // approved / partly paid — waiting for the accountant
  }
}

const ADVANCE_INCLUDE = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  paymentRequest: { select: { id: true, requestNumber: true, status: true, paidAmount: true, rejectionReason: true } },
  recoveries: { select: { amount: true, createdAt: true, runLine: { select: { run: { select: { year: true, month: true } } } } }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SalaryAdvanceInclude;

type AdvanceRow = Prisma.SalaryAdvanceGetPayload<{ include: typeof ADVANCE_INCLUDE }>;

function toView(a: AdvanceRow) {
  const amount = num(a.amount);
  const recovered = round2(a.recoveries.reduce((s, r) => s + num(r.amount), 0));
  return {
    id: a.id,
    employee: a.employee,
    amount,
    installments: a.installments,
    installmentAmount: num(a.installmentAmount),
    reason: a.reason,
    createdAt: a.createdAt,
    paymentRequest: { id: a.paymentRequest.id, requestNumber: a.paymentRequest.requestNumber, status: a.paymentRequest.status, rejectionReason: a.paymentRequest.rejectionReason },
    status: deriveAdvanceStatus(a.paymentRequest.status, amount, recovered),
    recovered,
    remaining: round2(Math.max(0, amount - recovered)),
    recoveries: a.recoveries.map((r) => ({ amount: num(r.amount), year: r.runLine.run.year, month: r.runLine.run.month })),
  };
}

async function ownEmployeeId(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  return user?.employeeId ?? null;
}

/** view_all → every advance; otherwise only the caller's own. */
export async function listSalaryAdvances(actor: SalaryAdvanceActor) {
  const all = await PermissionService.can(actor.userId, MODULE, "view_all");
  const own = await ownEmployeeId(actor.userId);
  if (!all && !own) return { canSeeAll: false, hasEmployee: false, advances: [] };
  const rows = await prisma.salaryAdvance.findMany({
    where: { companyId: actor.companyId, ...(all ? {} : { employeeId: own! }) },
    include: ADVANCE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return { canSeeAll: all, hasEmployee: Boolean(own), advances: rows.map(toView) };
}

export async function requestSalaryAdvance(actor: SalaryAdvanceActor, input: RequestSalaryAdvanceInput) {
  const employeeId = await ownEmployeeId(actor.userId);
  if (!employeeId) throw new BusinessRuleError("VALIDATION_ERROR", "Your login is not linked to an employee, so you can't request an advance salary.");
  const open = await prisma.salaryAdvance.count({
    where: { companyId: actor.companyId, employeeId, paymentRequest: { status: { in: ["PENDING_APPROVAL", "APPROVED", "PARTIALLY_PAID"] } } },
  });
  if (open > 0) throw new BusinessRuleError("INVALID_STATE_TRANSITION", "You already have an advance waiting for approval or payment.");

  const installmentAmount = round2(Math.ceil((input.amount / input.installments) * 100) / 100);
  // The idempotency key makes a retry after a half-finished attempt reuse the same payment request.
  const pr = await createPaymentRequest(
    { companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null },
    {
      requestType: "SALARY_ADVANCE",
      amount: input.amount,
      employeeId,
      remark: `${input.reason} (recover in ${input.installments} installment${input.installments > 1 ? "s" : ""})`,
      idempotencyKey: `salary-advance:${input.requestKey}`,
    },
    { fromSource: true }
  );

  let advance;
  try {
    advance = await prisma.salaryAdvance.create({
      data: { companyId: actor.companyId, employeeId, paymentRequestId: pr.id, amount: input.amount, installments: input.installments, installmentAmount, reason: input.reason, requestedByUserId: actor.userId },
      include: ADVANCE_INCLUDE,
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      advance = await prisma.salaryAdvance.findUniqueOrThrow({ where: { paymentRequestId: pr.id }, include: ADVANCE_INCLUDE });
    } else throw err;
  }
  await writeAuditLog({ companyId: actor.companyId, userId: actor.userId, tableName: "hrms_salary_advances", recordId: advance.id, action: "CREATE", newValues: { amount: input.amount, installments: input.installments, paymentRequestId: pr.id } });
  return toView(advance);
}

/** The employee withdraws their own request before it is paid (payment request rules apply). */
export async function cancelSalaryAdvance(actor: SalaryAdvanceActor, advanceId: string) {
  const own = await ownEmployeeId(actor.userId);
  const advance = await prisma.salaryAdvance.findFirst({ where: { id: advanceId, companyId: actor.companyId, employeeId: own ?? "__none__" } });
  if (!advance) throw new BusinessRuleError("NOT_FOUND", "Advance not found.", { id: advanceId });
  await cancelPaymentRequest({ companyId: actor.companyId, userId: actor.userId, branchId: actor.branchId ?? null }, advance.paymentRequestId);
  const row = await prisma.salaryAdvance.findUniqueOrThrow({ where: { id: advanceId }, include: ADVANCE_INCLUDE });
  return toView(row);
}

/**
 * This month's installment per employee: for every paid advance with money
 * left, the smaller of its installment and what is left. Oldest first.
 */
export async function advanceInstallmentsFor(companyId: string, employeeIds: string[]) {
  const map = new Map<string, { total: number; items: { advanceId: string; amount: number }[] }>();
  if (employeeIds.length === 0) return map;
  const advances = await prisma.salaryAdvance.findMany({
    where: { companyId, employeeId: { in: employeeIds }, paymentRequest: { status: "PAID" } },
    select: { id: true, employeeId: true, amount: true, installmentAmount: true, recoveries: { select: { amount: true } } },
    orderBy: { createdAt: "asc" },
  });
  for (const a of advances) {
    const remaining = round2(num(a.amount) - a.recoveries.reduce((s, r) => s + num(r.amount), 0));
    if (remaining <= 0.005) continue;
    const take = round2(Math.min(num(a.installmentAmount), remaining));
    const cur = map.get(a.employeeId) ?? { total: 0, items: [] };
    cur.items.push({ advanceId: a.id, amount: take });
    cur.total = round2(cur.total + take);
    map.set(a.employeeId, cur);
  }
  return map;
}

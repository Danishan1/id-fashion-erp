import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { Module } from "@/config/rbac";
import type { RelatedModule } from "@prisma/client";

/**
 * Which records the shared "record attachments" API (files + voice notes)
 * serves, and how each one is permission-checked. A module added here gets
 * file upload, voice recording, preview and delete for free through
 * <AttachmentsPanel module="..." recordId="..." />.
 *
 * Every target says: which RBAC module gates it, and how to find the record
 * inside the actor's company (and branch scope, where the record has one) —
 * a record outside either is NOT_FOUND, same "deny as not-found" rule used
 * everywhere else.
 */
interface AttachmentTarget {
  rbacModule: Module;
  /** Returns the record's current status (stored as the attachment's context
   * label) or null when the record isn't visible to this company. */
  load: (companyId: string, recordId: string) => Promise<{ branchId: string | null; status: string } | null>;
}

const TARGETS: Partial<Record<RelatedModule, AttachmentTarget>> = {
  EXPENSE: {
    rbacModule: "expenses",
    load: (companyId, id) =>
      prisma.expense.findFirst({ where: { id, companyId }, select: { branchId: true, status: true } }),
  },
  EXPENSE_PAYMENT: {
    rbacModule: "expenses",
    load: async (companyId, id) => {
      const payment = await prisma.expensePayment.findFirst({
        where: { id, companyId },
        select: { branchId: true },
      });
      return payment ? { branchId: payment.branchId, status: "PAID" } : null;
    },
  },
  EMPLOYEE_ADVANCE: {
    rbacModule: "expenses",
    load: (companyId, id) =>
      prisma.employeeAdvance.findFirst({ where: { id, companyId }, select: { branchId: true, status: true } }),
  },
  EMPLOYEE_ADVANCE_SETTLEMENT: {
    rbacModule: "expenses",
    load: async (companyId, id) => {
      const settlement = await prisma.employeeAdvanceSettlement.findFirst({
        where: { id, companyId },
        select: { status: true, employeeAdvance: { select: { branchId: true } } },
      });
      return settlement ? { branchId: settlement.employeeAdvance.branchId, status: settlement.status } : null;
    },
  },
  INTERNAL_TRANSFER: {
    rbacModule: "accounts",
    load: (companyId, id) =>
      prisma.internalTransfer.findFirst({ where: { id, companyId }, select: { branchId: true, status: true } }),
  },
  PAYMENT: {
    rbacModule: "payments",
    load: (companyId, id) =>
      prisma.payment.findFirst({ where: { id, companyId }, select: { branchId: true, status: true } }),
  },
};

/** URL slug <-> RelatedModule, e.g. "expense-payment" <-> EXPENSE_PAYMENT. */
export function relatedModuleFromSlug(slug: string): RelatedModule {
  const candidate = slug.toUpperCase().replace(/-/g, "_") as RelatedModule;
  if (!TARGETS[candidate]) throw new BusinessRuleError("NOT_FOUND", "Attachments are not available here.", { module: slug });
  return candidate;
}

/**
 * Checks that the actor may view (or, with action "create", add to / remove
 * from) this record's attachments, and returns the record's current status.
 * Uploading and deleting both use "create" — the same rule the settlement bill
 * uploads already used, so a junior accounts user can attach their own bills.
 */
export async function assertAttachmentAccess(
  actor: { companyId: string; userId: string },
  relatedModule: RelatedModule,
  recordId: string,
  action: "view" | "create"
): Promise<{ status: string }> {
  const target = TARGETS[relatedModule];
  if (!target) throw new BusinessRuleError("NOT_FOUND", "Attachments are not available here.", { module: relatedModule });

  await PermissionService.assert(actor.userId, target.rbacModule, action);

  const record = await target.load(actor.companyId, recordId);
  if (!record) throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id: recordId });

  const allowedBranchIds = await PermissionService.getAllowedBranchIds(actor.userId);
  if (allowedBranchIds !== null && (!record.branchId || !allowedBranchIds.has(record.branchId))) {
    throw new BusinessRuleError("NOT_FOUND", "Record not found.", { id: recordId });
  }

  return { status: record.status };
}

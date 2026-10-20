import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = vi.hoisted(() => ({
  jobOrderAssignment: { update: vi.fn() },
  productionHandback: { create: vi.fn() },
}));
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  jobOrderAssignment: { findFirst: vi.fn() },
  attachment: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
}));
vi.mock("@/core/db/client", () => ({ prisma: db }));
vi.mock("@/core/audit/AuditLogger", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/core/rbac/PermissionService", () => ({ PermissionService: { can: vi.fn(), assert: vi.fn() } }));
vi.mock("@/core/attachments/AttachmentService", () => ({
  uploadAttachment: vi.fn(),
  listAttachments: vi.fn(),
  getAttachmentForDownload: vi.fn(),
  deleteAttachment: vi.fn(),
}));
vi.mock("./assignment-capacity", () => ({
  ACTIVE_ASSIGNMENT_STATUSES: ["ASSIGNED", "IN_PROGRESS"],
  EPSILON: 0.0001,
  lockAssignmentInTx: vi.fn(),
  sumAssignmentConsumed: vi.fn(),
  syncAssignmentStatusInTx: vi.fn(),
}));
vi.mock("./job-order.service", () => ({ assertJobOrderScope: vi.fn(), getJobOrderById: vi.fn() }));
vi.mock("./production-scope", () => ({ getProductionApprovalTeam: vi.fn() }));

const { PermissionService } = await import("@/core/rbac/PermissionService");
const Attach = await import("@/core/attachments/AttachmentService");
const Cap = await import("./assignment-capacity");
const JO = await import("./job-order.service");
const { getProductionApprovalTeam } = await import("./production-scope");
const { handBackAssignment, uploadJobOrderSlip, getJobOrderSlipForDownload, deleteJobOrderSlip } = await import(
  "./work-portal.service"
);

const actor = { companyId: "co-1", userId: "u-worker" };
const assignmentRow = {
  id: "as-1",
  employeeId: "emp-1",
  jobOrder: { id: "jo-1", productionStageId: "st-1", lot: { branchId: "br-1" } },
};

beforeEach(() => {
  db.user.findUnique.mockReset().mockResolvedValue({ employeeId: "emp-1" });
  db.jobOrderAssignment.findFirst.mockReset().mockResolvedValue(assignmentRow);
  db.attachment.findFirst.mockReset();
  db.$transaction.mockClear();
  tx.jobOrderAssignment.update.mockReset();
  tx.productionHandback.create.mockReset().mockResolvedValue({ id: "hb-1" });
  vi.mocked(PermissionService.can).mockReset().mockResolvedValue(false);
  vi.mocked(PermissionService.assert).mockReset().mockResolvedValue(undefined);
  vi.mocked(Cap.lockAssignmentInTx).mockReset().mockResolvedValue({ status: "IN_PROGRESS", assignedQuantity: "10" } as never);
  vi.mocked(Cap.sumAssignmentConsumed).mockReset().mockResolvedValue(4);
  vi.mocked(Cap.syncAssignmentStatusInTx).mockReset();
  vi.mocked(JO.assertJobOrderScope).mockReset().mockResolvedValue(undefined);
  vi.mocked(JO.getJobOrderById).mockReset();
  vi.mocked(getProductionApprovalTeam).mockReset().mockResolvedValue(null);
  for (const fn of Object.values(Attach)) vi.mocked(fn as never as ReturnType<typeof vi.fn>).mockReset?.();
});

describe("handBackAssignment (P4)", () => {
  it("lets the worker hand back unworked pieces and reduces the assignment", async () => {
    await handBackAssignment(actor, "as-1", { quantity: 6, reason: "machine down" });
    expect(tx.jobOrderAssignment.update).toHaveBeenCalledWith({ where: { id: "as-1" }, data: { assignedQuantity: 4 } });
    expect(Cap.syncAssignmentStatusInTx).toHaveBeenCalledWith(tx, "as-1");
    expect(tx.productionHandback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantity: 6, reason: "machine down", assignedQuantityBefore: 10, employeeId: "emp-1" }),
    });
  });

  it("refuses more than assigned minus already logged (pending entries included)", async () => {
    await expect(handBackAssignment(actor, "as-1", { quantity: 7, reason: "too many" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(Cap.sumAssignmentConsumed).toHaveBeenCalledWith(tx, "as-1", { includePending: true });
    expect(tx.jobOrderAssignment.update).not.toHaveBeenCalled();
  });

  it("cancels the assignment when every untouched piece is handed back", async () => {
    vi.mocked(Cap.sumAssignmentConsumed).mockResolvedValue(0);
    await handBackAssignment(actor, "as-1", { quantity: 10, reason: "reassign" });
    expect(tx.jobOrderAssignment.update).toHaveBeenCalledWith({
      where: { id: "as-1" },
      data: { assignedQuantity: 0, status: "CANCELLED" },
    });
  });

  it("refuses a completed assignment", async () => {
    vi.mocked(Cap.lockAssignmentInTx).mockResolvedValue({ status: "COMPLETED", assignedQuantity: "10" } as never);
    await expect(handBackAssignment(actor, "as-1", { quantity: 1, reason: "late" })).rejects.toMatchObject({
      code: "INVALID_STATE_TRANSITION",
    });
  });

  it("hides another worker's assignment from a user without production.edit", async () => {
    db.user.findUnique.mockResolvedValue({ employeeId: "emp-other" });
    await expect(handBackAssignment(actor, "as-1", { quantity: 1, reason: "x reason" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("a supervisor outside the worker's Production team can't hand back for them", async () => {
    db.user.findUnique.mockResolvedValue({ employeeId: "emp-sup" });
    vi.mocked(PermissionService.can).mockResolvedValue(true);
    vi.mocked(getProductionApprovalTeam).mockResolvedValue(new Set(["emp-9"]));
    await expect(handBackAssignment(actor, "as-1", { quantity: 1, reason: "x reason" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("job order slips (P4)", () => {
  const jobOrder = {
    id: "jo-1",
    productionStageId: "st-1",
    productionStage: { name: "Stitching" },
    lot: { branchId: "br-1" },
    assignments: [{ employeeId: "emp-1", status: "IN_PROGRESS" }],
  };
  const photo = { buffer: Buffer.from("x"), fileName: "slip.jpg", mimeType: "image/jpeg" };

  it("the assigned worker can upload a photo, tagged with the stage", async () => {
    vi.mocked(JO.getJobOrderById).mockResolvedValue(jobOrder as never);
    await uploadJobOrderSlip(actor, "jo-1", photo);
    expect(Attach.uploadAttachment).toHaveBeenCalledWith(actor, "JOB_ORDER", "jo-1", photo, "Stitching");
    expect(PermissionService.assert).not.toHaveBeenCalled();
  });

  it("only photos and PDFs are accepted", async () => {
    await expect(uploadJobOrderSlip(actor, "jo-1", { ...photo, mimeType: "application/zip" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(Attach.uploadAttachment).not.toHaveBeenCalled();
  });

  it("someone not assigned needs production.edit", async () => {
    vi.mocked(JO.getJobOrderById).mockResolvedValue({ ...jobOrder, assignments: [] } as never);
    vi.mocked(PermissionService.assert).mockRejectedValue(Object.assign(new Error("no"), { code: "PERMISSION_DENIED" }));
    await expect(uploadJobOrderSlip(actor, "jo-1", photo)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("download refuses a file that belongs to another record", async () => {
    vi.mocked(JO.getJobOrderById).mockResolvedValue(jobOrder as never);
    vi.mocked(Attach.getAttachmentForDownload).mockResolvedValue({
      attachment: { relatedModule: "EMPLOYEE", relatedRecordId: "emp-1" },
      buffer: Buffer.from(""),
    } as never);
    await expect(getJobOrderSlipForDownload(actor, "jo-1", "att-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("download needs the job order to be visible to the caller", async () => {
    vi.mocked(JO.getJobOrderById).mockRejectedValue(Object.assign(new Error("nf"), { code: "NOT_FOUND" }));
    await expect(getJobOrderSlipForDownload(actor, "jo-1", "att-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(Attach.getAttachmentForDownload).not.toHaveBeenCalled();
  });

  it("the uploader can delete their own slip without production.edit", async () => {
    vi.mocked(JO.getJobOrderById).mockResolvedValue(jobOrder as never);
    db.attachment.findFirst.mockResolvedValue({ uploadedById: "u-worker" });
    await deleteJobOrderSlip(actor, "jo-1", "att-1");
    expect(PermissionService.assert).not.toHaveBeenCalled();
    expect(Attach.deleteAttachment).toHaveBeenCalledWith(actor, "att-1");
  });
});

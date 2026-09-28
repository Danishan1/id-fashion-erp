import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertEntryWithinAssignmentInTx,
  computeAvailableToCommit,
  consumedOf,
  syncAssignmentStatusInTx,
} from "./assignment-capacity";

/**
 * An in-memory stand-in for the Prisma transaction client — just enough of
 * jobOrderAssignment / jobOrderProgressEntry / jobWorkOrder for these rules,
 * so the real arithmetic (not a mock of it) is what's under test.
 */
function fakeTx(state: {
  assignments: { id: string; jobOrderId: string; assignedQuantity: number; status: string; startedAt?: Date | null; employee?: { id: string; fullName: string } }[];
  entries: { id: string; jobOrderAssignmentId: string; completed: number; rejected: number; damaged: number; extra: number; approvalStatus: string; isAdjustment?: boolean }[];
  jobWork?: { jobOrderId: string; status: string; issued: number; received: number; rejected: number; damaged: number }[];
}) {
  const matchStatus = (status: string, filter: { not?: string; in?: string[] }) =>
    filter.not !== undefined ? status !== filter.not : (filter.in ?? []).includes(status);

  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    jobOrderAssignment: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = state.assignments.find((x) => x.id === where.id);
        if (!a) throw new Error("not found");
        return { ...a, employee: a.employee ?? { id: "emp-1", fullName: "Asha" } };
      }),
      findMany: vi.fn(async ({ where }: { where: { jobOrderId: string; status: { in: string[] }; id?: { not: string } } }) =>
        state.assignments.filter(
          (a) => a.jobOrderId === where.jobOrderId && where.status.in.includes(a.status) && (!where.id || a.id !== where.id.not),
        ),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const a = state.assignments.find((x) => x.id === where.id)!;
        Object.assign(a, data);
        return a;
      }),
    },
    jobOrderProgressEntry: {
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: { jobOrderAssignmentId: string; approvalStatus: { not?: string; in?: string[] }; id?: { not: string } };
        }) => {
          const rows = state.entries.filter(
            (e) =>
              e.jobOrderAssignmentId === where.jobOrderAssignmentId &&
              !e.isAdjustment &&
              matchStatus(e.approvalStatus, where.approvalStatus) &&
              (!where.id || e.id !== where.id.not),
          );
          const sum = (k: "completed" | "rejected" | "damaged" | "extra") => rows.reduce((s, r) => s + r[k], 0);
          return {
            _sum: {
              completedQuantity: sum("completed"),
              rejectedQuantity: sum("rejected"),
              damagedQuantity: sum("damaged"),
              extraQuantity: sum("extra"),
            },
          };
        },
      ),
    },
    jobWorkOrder: {
      findMany: vi.fn(async ({ where }: { where: { jobOrderId: string } }) =>
        (state.jobWork ?? [])
          .filter((j) => j.jobOrderId === where.jobOrderId && !["CANCELLED", "CLOSED"].includes(j.status))
          .map((j) => ({ issuedQuantity: j.issued, receivedQuantity: j.received, rejectedQuantity: j.rejected, damagedQuantity: j.damaged })),
      ),
    },
  } as never;
}

const normalStage = { name: "Stitching", allowsExtraQuantity: false };
const cuttingStage = { name: "Cutting", allowsExtraQuantity: true };

describe("consumedOf", () => {
  it("counts extra as part of completed, not additional to it", () => {
    expect(consumedOf({ completed: 105, rejected: 0, damaged: 0, extra: 5 })).toBe(100);
    expect(consumedOf({ completed: 90, rejected: 5, damaged: 5, extra: 0 })).toBe(100);
  });
});

describe("assertEntryWithinAssignmentInTx — Completed + Rejected + Damage vs Assigned", () => {
  let state: Parameters<typeof fakeTx>[0];
  beforeEach(() => {
    state = { assignments: [{ id: "a1", jobOrderId: "jo-1", assignedQuantity: 100, status: "ASSIGNED" }], entries: [] };
  });

  it("accepts 90 + 5 + 5 = 100 against 100 assigned", async () => {
    const result = await assertEntryWithinAssignmentInTx(fakeTx(state), {
      assignmentId: "a1",
      stage: normalStage,
      entry: { completed: 90, rejected: 5, damaged: 5, extra: 0 },
    });
    expect(result.consumedAfter).toBe(100);
  });

  it("rejects 90 + 5 + 10 = 105 against 100 assigned", async () => {
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), {
        assignmentId: "a1",
        stage: normalStage,
        entry: { completed: 90, rejected: 5, damaged: 10, extra: 0 },
      }),
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED", message: expect.stringContaining("Assigned 100") });
  });

  it("is cumulative across a worker's entries (30 now, 40 later, 40 more is too many)", async () => {
    state.entries.push(
      { id: "e1", jobOrderAssignmentId: "a1", completed: 30, rejected: 0, damaged: 0, extra: 0, approvalStatus: "NOT_REQUIRED" },
      { id: "e2", jobOrderAssignmentId: "a1", completed: 38, rejected: 2, damaged: 0, extra: 0, approvalStatus: "NOT_REQUIRED" },
    );
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: 40, rejected: 0, damaged: 0, extra: 0 } }),
    ).rejects.toMatchObject({ message: expect.stringContaining("remaining 30") });
    const ok = await assertEntryWithinAssignmentInTx(fakeTx(state), {
      assignmentId: "a1",
      stage: normalStage,
      entry: { completed: 30, rejected: 0, damaged: 0, extra: 0 },
    });
    expect(ok.consumedAfter).toBe(100);
  });

  it("counts PENDING claims against the cap but ignores REJECTED ones", async () => {
    state.entries.push(
      { id: "p", jobOrderAssignmentId: "a1", completed: 60, rejected: 0, damaged: 0, extra: 0, approvalStatus: "PENDING" },
      { id: "r", jobOrderAssignmentId: "a1", completed: 90, rejected: 0, damaged: 0, extra: 0, approvalStatus: "REJECTED" },
    );
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: 41, rejected: 0, damaged: 0, extra: 0 } }),
    ).rejects.toMatchObject({ code: "OVER_PRODUCTION_NOT_ALLOWED" });
  });

  it("doesn't double-count the entry being approved itself", async () => {
    state.entries.push({ id: "p", jobOrderAssignmentId: "a1", completed: 100, rejected: 0, damaged: 0, extra: 0, approvalStatus: "PENDING" });
    const ok = await assertEntryWithinAssignmentInTx(fakeTx(state), {
      assignmentId: "a1",
      stage: normalStage,
      entry: { completed: 100, rejected: 0, damaged: 0, extra: 0 },
      excludeEntryId: "p",
    });
    expect(ok.consumedAfter).toBe(100);
  });

  describe("Cutting extra pieces", () => {
    it("allows cutting 105 of 100 assigned when 5 are recorded explicitly as extra", async () => {
      const ok = await assertEntryWithinAssignmentInTx(fakeTx(state), {
        assignmentId: "a1",
        stage: cuttingStage,
        entry: { completed: 105, rejected: 0, damaged: 0, extra: 5 },
      });
      expect(ok.consumedAfter).toBe(100);
    });

    it("never silently absorbs an over-count — 105 with no extra is rejected, with a hint to use Extra", async () => {
      await expect(
        assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: cuttingStage, entry: { completed: 105, rejected: 0, damaged: 0, extra: 0 } }),
      ).rejects.toMatchObject({ message: expect.stringContaining('"Extra"') });
    });

    it("rejects extra pieces on a stage that doesn't allow them", async () => {
      await expect(
        assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: 105, rejected: 0, damaged: 0, extra: 5 } }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: expect.stringContaining("only a stage that allows extra") });
    });

    it("rejects extra exceeding completed", async () => {
      await expect(
        assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: cuttingStage, entry: { completed: 3, rejected: 0, damaged: 0, extra: 5 } }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  it("rejects negative and all-zero entries", async () => {
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: -1, rejected: 0, damaged: 0, extra: 0 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: 0, rejected: 0, damaged: 0, extra: 0 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects logging against a completed or cancelled assignment", async () => {
    state.assignments[0].status = "COMPLETED";
    await expect(
      assertEntryWithinAssignmentInTx(fakeTx(state), { assignmentId: "a1", stage: normalStage, entry: { completed: 1, rejected: 0, damaged: 0, extra: 0 } }),
    ).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("syncAssignmentStatusInTx", () => {
  it("moves ASSIGNED → IN_PROGRESS on first applied work, then → COMPLETED when fully consumed", async () => {
    const state: Parameters<typeof fakeTx>[0] = {
      assignments: [{ id: "a1", jobOrderId: "jo-1", assignedQuantity: 100, status: "ASSIGNED", startedAt: null }],
      entries: [{ id: "e1", jobOrderAssignmentId: "a1", completed: 40, rejected: 0, damaged: 0, extra: 0, approvalStatus: "NOT_REQUIRED" }],
    };
    const tx = fakeTx(state);
    await syncAssignmentStatusInTx(tx, "a1");
    expect(state.assignments[0].status).toBe("IN_PROGRESS");

    state.entries.push({ id: "e2", jobOrderAssignmentId: "a1", completed: 55, rejected: 5, damaged: 0, extra: 0, approvalStatus: "APPROVED" });
    await syncAssignmentStatusInTx(tx, "a1");
    expect(state.assignments[0].status).toBe("COMPLETED");
  });

  it("never completes an assignment on a merely PENDING claim", async () => {
    const state: Parameters<typeof fakeTx>[0] = {
      assignments: [{ id: "a1", jobOrderId: "jo-1", assignedQuantity: 100, status: "ASSIGNED", startedAt: null }],
      entries: [{ id: "e1", jobOrderAssignmentId: "a1", completed: 100, rejected: 0, damaged: 0, extra: 0, approvalStatus: "PENDING" }],
    };
    await syncAssignmentStatusInTx(fakeTx(state), "a1");
    expect(state.assignments[0].status).toBe("ASSIGNED");
  });
});

describe("computeAvailableToCommit — one pool shared by workers and contractors", () => {
  it("subtracts done work, un-worked internal assignments and pending external job work", async () => {
    const state: Parameters<typeof fakeTx>[0] = {
      assignments: [
        { id: "a1", jobOrderId: "jo-1", assignedQuantity: 30, status: "IN_PROGRESS" },
        { id: "a2", jobOrderId: "jo-1", assignedQuantity: 40, status: "ASSIGNED" },
        { id: "a3", jobOrderId: "jo-1", assignedQuantity: 50, status: "CANCELLED" },
      ],
      entries: [{ id: "e1", jobOrderAssignmentId: "a1", completed: 20, rejected: 0, damaged: 0, extra: 0, approvalStatus: "NOT_REQUIRED" }],
      jobWork: [
        { jobOrderId: "jo-1", status: "ISSUED", issued: 15, received: 5, rejected: 0, damaged: 0 },
        { jobOrderId: "jo-1", status: "CANCELLED", issued: 99, received: 0, rejected: 0, damaged: 0 },
      ],
    };
    // planned 100, done 20 (a1's logged work). Un-worked internal: a1 10 + a2 40 = 50. Pending external: 10.
    const result = await computeAvailableToCommit(fakeTx(state), {
      id: "jo-1",
      plannedQuantity: 100,
      extraQuantity: 0,
      completedQuantity: 20,
      rejectedQuantity: 0,
      damagedQuantity: 0,
    });
    expect(result).toEqual({ available: 20, capacity: 100, done: 20, unworkedInternal: 50, pendingExternal: 10 });
  });

  it("includes recorded extra pieces in capacity and never goes negative", async () => {
    const state: Parameters<typeof fakeTx>[0] = { assignments: [], entries: [] };
    const withExtra = await computeAvailableToCommit(fakeTx(state), {
      id: "jo-1",
      plannedQuantity: 100,
      extraQuantity: 5,
      completedQuantity: 100,
      rejectedQuantity: 0,
      damagedQuantity: 0,
    });
    expect(withExtra.available).toBe(5);
    const over = await computeAvailableToCommit(fakeTx(state), {
      id: "jo-1",
      plannedQuantity: 10,
      extraQuantity: 0,
      completedQuantity: 20,
      rejectedQuantity: 0,
      damagedQuantity: 0,
    });
    expect(over.available).toBe(0);
  });
});

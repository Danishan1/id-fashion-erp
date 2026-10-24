import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, MockWorker, MockQueue, mockCreditCurrentMonth } = vi.hoisted(() => {
  const state: { lastWorker: { _handler: (job: { name: string; id?: string }) => Promise<unknown> } | null } = {
    lastWorker: null,
  };

  class WorkerCls {
    _handler: (job: { name: string; id?: string }) => Promise<unknown>;
    on = vi.fn();
    constructor(_queue: unknown, handler: (job: { name: string; id?: string }) => Promise<unknown>) {
      this._handler = handler;
      state.lastWorker = this;
    }
  }

  class QueueCls {
    upsertJobScheduler = vi.fn().mockResolvedValue({});
  }

  return {
    mockState: state,
    MockWorker: WorkerCls,
    MockQueue: QueueCls,
    mockCreditCurrentMonth: vi.fn().mockResolvedValue({ created: 5 }),
  };
});

vi.mock("bullmq", () => ({
  Worker: MockWorker,
  Queue: MockQueue,
}));

vi.mock("@/core/jobs/queue", () => ({
  createRedisConnection: vi.fn().mockReturnValue({}),
  databaseScopedQueueName: (name: string) => `test-db-${name}`,
}));

vi.mock("./leave-balance.service", () => ({
  creditCurrentMonthForAllCompanies: mockCreditCurrentMonth,
}));

import {
  ATTENDANCE_JOBS_QUEUE_NAME,
  startAttendanceJobsWorker,
} from "./attendance-jobs.worker";

describe("attendance-jobs.worker (Unit Tests)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.lastWorker = null;
  });

  it("initializes worker and job scheduler on correct queue", () => {
    const worker = startAttendanceJobsWorker();
    expect(ATTENDANCE_JOBS_QUEUE_NAME).toContain("hrms-attendance");
    expect(worker).toBeDefined();
  });

  it("handles 'leave.monthly-credit' job successfully", async () => {
    startAttendanceJobsWorker();
    const result = await mockState.lastWorker!._handler({ name: "leave.monthly-credit" });
    expect(mockCreditCurrentMonth).toHaveBeenCalled();
    expect(result).toEqual({ created: 5 });
  });

  it("throws error on unknown job name", async () => {
    startAttendanceJobsWorker();
    await expect(mockState.lastWorker!._handler({ name: "unknown.job" })).rejects.toThrow('Unknown attendance job "unknown.job"');
  });
});

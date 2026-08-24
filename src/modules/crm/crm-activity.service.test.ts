import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./crm-activity.repository", () => ({
  CrmActivityRepository: { create: vi.fn(), findByRelated: vi.fn() },
  CrmFollowupRepository: {
    countOverdue: vi.fn(),
    countDueToday: vi.fn(),
    countUpcoming: vi.fn(),
    countCompleted: vi.fn(),
  },
}));

const { CrmFollowupRepository } = await import("./crm-activity.repository");
const { getFollowupCounters } = await import("./crm-activity.service");

beforeEach(() => {
  vi.mocked(CrmFollowupRepository.countOverdue).mockReset().mockResolvedValue(5);
  vi.mocked(CrmFollowupRepository.countDueToday).mockReset().mockResolvedValue(3);
  vi.mocked(CrmFollowupRepository.countUpcoming).mockReset().mockResolvedValue(8);
  vi.mocked(CrmFollowupRepository.countCompleted).mockReset().mockResolvedValue(24);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getFollowupCounters", () => {
  it("splits overdue from due-today using midnight as the boundary, not the exact current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T14:30:00"));

    const result = await getFollowupCounters("co-1");

    const [, startOfToday, startOfTomorrow] = vi.mocked(CrmFollowupRepository.countDueToday).mock.calls[0];
    expect(startOfToday.toISOString().slice(0, 10)).toBe(new Date("2026-08-24T00:00:00").toISOString().slice(0, 10));
    expect(startOfTomorrow.getTime() - startOfToday.getTime()).toBe(24 * 60 * 60 * 1000);

    expect(CrmFollowupRepository.countOverdue).toHaveBeenCalledWith("co-1", startOfToday);
    expect(CrmFollowupRepository.countUpcoming).toHaveBeenCalledWith("co-1", startOfTomorrow);

    expect(result).toEqual({ overdue: 5, dueToday: 3, upcoming: 8, completed: 24, pending: 16 });
  });
});

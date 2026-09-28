import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/db/client", () => ({
  prisma: {
    crmActivity: { findMany: vi.fn() },
    crmStageHistory: { findMany: vi.fn() },
    crmAssignmentHistory: { findMany: vi.fn() },
    crmFollowup: { findMany: vi.fn() },
    attachment: { findMany: vi.fn() },
  },
}));
vi.mock("./lead.repository", () => ({ LeadRepository: { findAnyById: vi.fn() } }));

const { prisma } = await import("@/core/db/client");
const { LeadRepository } = await import("./lead.repository");
const { getLeadTimeline } = await import("./lead-timeline.service");

const d = (s: string) => new Date(s);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(LeadRepository.findAnyById).mockResolvedValue({ id: "lead-1" } as never);
  vi.mocked(prisma.crmActivity.findMany).mockResolvedValue([
    { id: "a1", activityType: "CALL", subject: "Called buyer", body: null, activityAt: d("2026-09-02T10:00:00Z"), performedBy: { fullName: "Asha" } },
    // Stage-change note duplicates a stage-history row — must not appear twice.
    { id: "a2", activityType: "NOTE", subject: "Stage changed: New → Contacted", body: null, activityAt: d("2026-09-03T10:00:00Z"), performedBy: { fullName: "Asha" } },
  ] as never);
  vi.mocked(prisma.crmStageHistory.findMany).mockResolvedValue([
    { id: "s1", changedAt: d("2026-09-01T09:00:00Z"), comment: "Lead created", fromStage: null, toStage: { name: "New" }, changedBy: { fullName: "Asha" } },
    { id: "s2", changedAt: d("2026-09-03T10:00:00Z"), comment: null, fromStage: { name: "New" }, toStage: { name: "Contacted" }, changedBy: { fullName: "Asha" } },
  ] as never);
  vi.mocked(prisma.crmAssignmentHistory.findMany).mockResolvedValue([]);
  vi.mocked(prisma.crmFollowup.findMany).mockResolvedValue([
    {
      id: "f1",
      createdAt: d("2026-09-02T10:05:00Z"),
      followupDate: d("2026-09-05T10:00:00Z"),
      type: "CALL",
      status: "COMPLETED",
      completedAt: d("2026-09-05T11:00:00Z"),
      notes: null,
      createdBy: { fullName: "Asha" },
      assignedTo: { fullName: "Asha" },
    },
  ] as never);
  vi.mocked(prisma.attachment.findMany).mockResolvedValue([]);
});

describe("getLeadTimeline", () => {
  it("merges every source newest-first without listing stage changes twice", async () => {
    const t = await getLeadTimeline("co-1", "lead-1");
    expect(t.map((e) => e.id)).toEqual(["fc-f1", "s-s2", "f-f1", "a-a1", "s-s1"]);
    expect(t.find((e) => e.id === "s-s1")?.type).toBe("LEAD_CREATED");
  });

  it("rejects a lead from another company", async () => {
    vi.mocked(LeadRepository.findAnyById).mockResolvedValue(null);
    await expect(getLeadTimeline("co-1", "lead-x")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./crm-config.service", () => ({ listPipelineStages: vi.fn(), getEntryStage: vi.fn() }));
vi.mock("./crm-settings.service", () => ({ getCrmSettings: vi.fn().mockResolvedValue({ hotThreshold: 80, warmThreshold: 50 }) }));

const { listPipelineStages, getEntryStage } = await import("./crm-config.service");
const { buildLeadSegmentWheres, createdRangeWhere, isLeadSegment } = await import("./lead-segments");

const STAGES = [
  { id: "s1", code: "NEW_LEAD", kind: "OPEN", sortOrder: 10 },
  { id: "s4", code: "QUALIFICATION", kind: "OPEN", sortOrder: 40 },
  { id: "s7", code: "QUOTATION_SENT", kind: "OPEN", sortOrder: 70 },
  { id: "sw", code: "WON", kind: "WON", sortOrder: 100 },
];

beforeEach(() => {
  vi.mocked(listPipelineStages).mockResolvedValue(STAGES as never);
  vi.mocked(getEntryStage).mockResolvedValue(STAGES[0] as never);
});

describe("buildLeadSegmentWheres", () => {
  it("QUALIFIED/QUOTATION = Won, or open at/after the anchor stage by pipeline order", async () => {
    const w = await buildLeadSegmentWheres("co-1");
    expect(w.QUALIFIED).toEqual({ OR: [{ stage: { kind: "WON" } }, { stage: { kind: "OPEN", sortOrder: { gte: 40 } } }] });
    expect(w.QUOTATION).toEqual({ OR: [{ stage: { kind: "WON" } }, { stage: { kind: "OPEN", sortOrder: { gte: 70 } } }] });
  });

  it("falls back to Won-only when the anchor stage has been removed", async () => {
    vi.mocked(listPipelineStages).mockResolvedValue([STAGES[0], STAGES[3]] as never);
    const w = await buildLeadSegmentWheres("co-1");
    expect(w.QUALIFIED).toEqual({ stage: { kind: "WON" } });
  });

  it("NEW is the entry stage; NEVER_CONTACTED is open with no activity; HOT uses the company threshold", async () => {
    const w = await buildLeadSegmentWheres("co-1");
    expect(w.NEW).toEqual({ stageId: "s1" });
    expect(w.NEVER_CONTACTED).toEqual({ lastActivityAt: null, stage: { kind: "OPEN" } });
    expect(w.HOT).toEqual({ leadScore: { gte: 80 } });
  });

  it("NEW matches nothing when no open entry stage exists", async () => {
    vi.mocked(getEntryStage).mockRejectedValue(new Error("none"));
    const w = await buildLeadSegmentWheres("co-1");
    expect(w.NEW).toEqual({ id: { in: [] } });
  });
});

describe("createdRangeWhere", () => {
  it("makes dateTo inclusive of the whole local day", () => {
    const w = createdRangeWhere("2026-09-01", "2026-09-30") as { createdAt: { gte: Date; lte: Date } };
    expect(w.createdAt.gte.getTime()).toBe(new Date("2026-09-01T00:00:00").getTime());
    expect(w.createdAt.lte.getTime()).toBe(new Date("2026-09-30T23:59:59.999").getTime());
  });

  it("ignores blank or malformed dates", () => {
    expect(createdRangeWhere("", undefined)).toEqual({});
    expect(createdRangeWhere("not-a-date", null)).toEqual({});
  });
});

describe("isLeadSegment", () => {
  it("accepts known segments only", () => {
    expect(isLeadSegment("WON")).toBe(true);
    expect(isLeadSegment("won")).toBe(false);
    expect(isLeadSegment(undefined)).toBe(false);
  });
});

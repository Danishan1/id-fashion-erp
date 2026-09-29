import { describe, expect, it } from "vitest";
import { saveStageCostsSchema } from "./stage-cost.schema";

const STAGE = "11111111-1111-4111-8111-111111111111";

describe("saveStageCostsSchema", () => {
  it("keeps null as null (clear / revert to inherited) — never coerced to a ₹0 cost", () => {
    const parsed = saveStageCostsSchema.parse({ costs: [{ productionStageId: STAGE, cost: null }] });
    expect(parsed.costs[0].cost).toBeNull();
  });

  it("accepts a genuine 0 and numeric strings", () => {
    expect(saveStageCostsSchema.parse({ costs: [{ productionStageId: STAGE, cost: 0 }] }).costs[0].cost).toBe(0);
    expect(saveStageCostsSchema.parse({ costs: [{ productionStageId: STAGE, cost: "12.5" }] }).costs[0].cost).toBe(12.5);
  });

  it("rejects negative costs and duplicate stages", () => {
    expect(() => saveStageCostsSchema.parse({ costs: [{ productionStageId: STAGE, cost: -1 }] })).toThrow();
    expect(() =>
      saveStageCostsSchema.parse({ costs: [{ productionStageId: STAGE, cost: 1 }, { productionStageId: STAGE, cost: 2 }] }),
    ).toThrow();
  });
});

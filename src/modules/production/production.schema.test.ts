import { describe, expect, it } from "vitest";
import { createQcInspectionSchema } from "./production.schema";

describe("createQcInspectionSchema", () => {
  // Regression test for the P2 fix: 0.1 + 0.2 !== 0.3 under exact float
  // equality, which previously rejected a mathematically-correct decimal
  // split with no workaround.
  it("accepts a decimal split whose exact sum is imprecise under IEEE-754", () => {
    const result = createQcInspectionSchema.safeParse({
      inspectedQuantity: 0.3,
      acceptedQuantity: 0.1,
      rejectedQuantity: 0,
      damagedQuantity: 0.2,
      result: "PARTIAL_PASS",
      reworkTargetStageId: "11111111-1111-4111-8111-111111111111",
      defects: [],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a split that genuinely doesn't add up", () => {
    const result = createQcInspectionSchema.safeParse({
      inspectedQuantity: 10,
      acceptedQuantity: 5,
      rejectedQuantity: 0,
      damagedQuantity: 0,
      result: "PASS",
      defects: [],
    });
    expect(result.success).toBe(false);
  });

  // Regression test for the P3 fix: a pure-damage disposition (damaged > 0,
  // rejected === 0) never reaches the service's reworkTargetStageId lookup at
  // all, so the schema must not force one to be supplied — previously this
  // was unrecordable at a job order's very first production stage (no
  // earlier stage exists to name).
  it("does not require a rework target stage for a pure-damage FAIL", () => {
    const result = createQcInspectionSchema.safeParse({
      inspectedQuantity: 5,
      acceptedQuantity: 0,
      rejectedQuantity: 0,
      damagedQuantity: 5,
      result: "FAIL",
      damageWarehouseId: "11111111-1111-4111-8111-111111111111",
      defects: [],
    });
    expect(result.success).toBe(true);
  });

  it("still requires a rework target stage whenever any quantity is rejected", () => {
    const result = createQcInspectionSchema.safeParse({
      inspectedQuantity: 5,
      acceptedQuantity: 0,
      rejectedQuantity: 5,
      damagedQuantity: 0,
      result: "FAIL",
      defects: [],
    });
    expect(result.success).toBe(false);
  });
});

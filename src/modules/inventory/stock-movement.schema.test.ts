import { describe, expect, it } from "vitest";
import { createStockMovementSchema } from "./stock-movement.schema";

const WAREHOUSE = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const UOM = "33333333-3333-4333-8333-333333333333";
const VARIANT = "44444444-4444-4444-8444-444444444444";
const SUPPLIER = "55555555-5555-4555-8555-555555555555";

const baseAdjustment = { movementType: "ADJUSTMENT" as const, warehouseId: WAREHOUSE, reason: "Physical count" };

describe("createStockMovementSchema — item-type-family validation (FGI-014, Decision 2/§4.4)", () => {
  it("accepts a plain raw-material document with no itemFamily field at all — defaults to RAW_MATERIAL, zero behavior change for every existing caller", () => {
    const result = createStockMovementSchema.safeParse({
      ...baseAdjustment,
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5 }],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.itemFamily).toBe("RAW_MATERIAL");
  });

  it("rejects a Finished Goods document where a line is missing productVariantId", () => {
    const result = createStockMovementSchema.safeParse({
      ...baseAdjustment,
      itemFamily: "FINISHED_GOODS",
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5 }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects a Raw Material document where a line carries a productVariantId — the Zod-layer half of the mixing defense", () => {
    const result = createStockMovementSchema.safeParse({
      ...baseAdjustment,
      itemFamily: "RAW_MATERIAL",
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5, productVariantId: VARIANT }],
    });

    expect(result.success).toBe(false);
  });

  it("accepts a well-formed Finished Goods document where every line carries a productVariantId", () => {
    const result = createStockMovementSchema.safeParse({
      ...baseAdjustment,
      itemFamily: "FINISHED_GOODS",
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5, productVariantId: VARIANT }],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a Finished Goods document where only SOME lines carry a productVariantId — a real document can't partially mix shapes", () => {
    const result = createStockMovementSchema.safeParse({
      ...baseAdjustment,
      itemFamily: "FINISHED_GOODS",
      items: [
        { productId: PRODUCT, uomId: UOM, quantity: 5, productVariantId: VARIANT },
        { productId: "66666666-6666-4666-8666-666666666666", uomId: UOM, quantity: 3 },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects RETURN_TO_SUPPLIER for a Finished Goods document — §4.4's own stated rule, finished goods never go back to a raw-material supplier", () => {
    const result = createStockMovementSchema.safeParse({
      movementType: "RETURN_TO_SUPPLIER",
      warehouseId: WAREHOUSE,
      supplierId: SUPPLIER,
      itemFamily: "FINISHED_GOODS",
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5, productVariantId: VARIANT }],
    });

    expect(result.success).toBe(false);
  });

  it("still allows RETURN_TO_SUPPLIER for a Raw Material document — unaffected by the new rule", () => {
    const result = createStockMovementSchema.safeParse({
      movementType: "RETURN_TO_SUPPLIER",
      warehouseId: WAREHOUSE,
      supplierId: SUPPLIER,
      itemFamily: "RAW_MATERIAL",
      items: [{ productId: PRODUCT, uomId: UOM, quantity: 5 }],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a Finished Goods TRANSFER carrying a toWarehouseLocationId on its line", () => {
    const result = createStockMovementSchema.safeParse({
      movementType: "TRANSFER",
      warehouseId: WAREHOUSE,
      toWarehouseId: "77777777-7777-4777-8777-777777777777",
      itemFamily: "FINISHED_GOODS",
      items: [
        {
          productId: PRODUCT,
          uomId: UOM,
          quantity: 5,
          productVariantId: VARIANT,
          toWarehouseLocationId: "88888888-8888-4888-8888-888888888888",
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});

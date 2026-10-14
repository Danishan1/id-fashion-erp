import { randomUUID } from "node:crypto";
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

// Finished Goods Inventory module (FGI-031) -- the Zod-layer half of
// relaxing the same-warehouse Transfer block specifically for Finished
// Goods. Deliberately a separate describe block (createStockMovementSchema is
// never actually invoked by stock-movement.service.test.ts's own calls --
// those call createStockMovement() directly with \`as never\`, bypassing Zod
// entirely -- so this refine's own behavior can only be proven by parsing
// through the real schema). Every id below is a real UUID (randomUUID()) --
// the schema's own .uuid() validators reject a plain slug like "wh-1".

const warehouseA = randomUUID();
const warehouseB = randomUUID();
const locationA = randomUUID();
const locationB = randomUUID();
const materialId = randomUUID();
const uomId = randomUUID();
const styleId = randomUUID();
const variant1 = randomUUID();
const variant2 = randomUUID();

const rawMaterialBaseInput = {
  movementType: "TRANSFER" as const,
  warehouseId: warehouseA,
  items: [{ productId: materialId, uomId, quantity: 10, remarks: "" }],
};

const finishedGoodsBaseInput = {
  movementType: "TRANSFER" as const,
  warehouseId: warehouseA,
  itemFamily: "FINISHED_GOODS" as const,
  items: [{ productId: styleId, uomId, quantity: 10, remarks: "", productVariantId: variant1 }],
};

describe("createStockMovementSchema -- same-warehouse Transfer (FGI-031)", () => {
  it("still rejects a same-warehouse raw-material Transfer, byte-for-byte unchanged from before FGI-031", () => {
    const result = createStockMovementSchema.safeParse({ ...rawMaterialBaseInput, toWarehouseId: warehouseA });
    expect(result.success).toBe(false);
  });

  it("still accepts a raw-material Transfer to a genuinely different warehouse, unchanged", () => {
    const result = createStockMovementSchema.safeParse({ ...rawMaterialBaseInput, toWarehouseId: warehouseB });
    expect(result.success).toBe(true);
  });

  it("rejects a same-warehouse Finished Goods Transfer when no line's location actually changes (both sides unset)", () => {
    const result = createStockMovementSchema.safeParse({ ...finishedGoodsBaseInput, toWarehouseId: warehouseA });
    expect(result.success).toBe(false);
  });

  it("rejects a same-warehouse Finished Goods Transfer when every line's source and destination location are the identical value", () => {
    const result = createStockMovementSchema.safeParse({
      ...finishedGoodsBaseInput,
      toWarehouseId: warehouseA,
      items: [
        {
          ...finishedGoodsBaseInput.items[0],
          warehouseLocationId: locationA,
          toWarehouseLocationId: locationA,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a same-warehouse Finished Goods Transfer when a line's location genuinely changes (location-to-location move)", () => {
    const result = createStockMovementSchema.safeParse({
      ...finishedGoodsBaseInput,
      toWarehouseId: warehouseA,
      items: [
        {
          ...finishedGoodsBaseInput.items[0],
          warehouseLocationId: locationA,
          toWarehouseLocationId: locationB,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a same-warehouse Finished Goods Transfer moving staging (no source location) into a real destination location", () => {
    const result = createStockMovementSchema.safeParse({
      ...finishedGoodsBaseInput,
      toWarehouseId: warehouseA,
      items: [{ ...finishedGoodsBaseInput.items[0], toWarehouseLocationId: locationB }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a Finished Goods Transfer to a genuinely different warehouse regardless of location fields, unchanged", () => {
    const result = createStockMovementSchema.safeParse({ ...finishedGoodsBaseInput, toWarehouseId: warehouseB });
    expect(result.success).toBe(true);
  });

  it("accepts the document when AT LEAST ONE of several lines shows a genuine location change, even if others don't", () => {
    const result = createStockMovementSchema.safeParse({
      ...finishedGoodsBaseInput,
      toWarehouseId: warehouseA,
      items: [
        { ...finishedGoodsBaseInput.items[0], productVariantId: variant1, warehouseLocationId: locationA, toWarehouseLocationId: locationA },
        { ...finishedGoodsBaseInput.items[0], productVariantId: variant2, warehouseLocationId: locationA, toWarehouseLocationId: locationB },
      ],
    });
    expect(result.success).toBe(true);
  });
});

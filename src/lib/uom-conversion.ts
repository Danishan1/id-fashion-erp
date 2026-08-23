import type { Prisma } from "@prisma/client";

interface UomLike {
  id: string;
  baseUnitId: string | null;
  conversionFactor: number | string | Prisma.Decimal;
}

/**
 * Returns `quantity` expressed in `toUom`, or null if no fixed conversion path exists between
 * the two units. Depth-1 only by design: a unit's baseUnitId must point to a ROOT unit
 * (baseUnitId === null), enforced at Unit create/update time (src/modules/lookups/lookup.service.ts)
 * — never a multi-hop chain. This keeps the function simple and correct instead of inviting a
 * future 2-hop case (e.g. a third unit derived from an already-derived unit) that would silently
 * break it.
 */
export function convertUomQuantity(quantity: number, fromUom: UomLike, toUom: UomLike): number | null {
  if (fromUom.id === toUom.id) return quantity;

  const fromFactor = Number(fromUom.conversionFactor);
  const toFactor = Number(toUom.conversionFactor);

  if (fromUom.baseUnitId === toUom.id) return quantity * fromFactor;
  if (toUom.baseUnitId === fromUom.id) return quantity / toFactor;
  if (fromUom.baseUnitId && fromUom.baseUnitId === toUom.baseUnitId) return (quantity * fromFactor) / toFactor;

  return null;
}

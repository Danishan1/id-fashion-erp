import { z } from "zod";

/**
 * Barcode Management & Scanning System, Phase 1 (2026-09-29) — Zod input
 * shapes for the manual "Generate Barcode" action and the label-print route.
 * Resolve/scan itself takes no body (the code is the URL param) so it needs
 * no schema here.
 */

// Kept in lockstep with prisma/schema.prisma's BarcodeEntityType enum by hand
// (Prisma's generated enum can't be imported into a Zod literal union
// directly without pulling @prisma/client into this otherwise-pure schema
// file) — every value here must exist in the real Prisma enum.
export const MANUALLY_GENERATABLE_ENTITY_TYPES = ["ITEM", "SKU"] as const;
export type ManuallyGeneratableEntityType = (typeof MANUALLY_GENERATABLE_ENTITY_TYPES)[number];

/**
 * Only ITEM (a raw-material Product) and SKU (a ProductVariant) are
 * generated on demand via this action — FABRIC_ROLL/PRODUCTION_LOT/CARTON
 * are always minted automatically at the point their underlying entity is
 * created (Goods Receipt / Lot creation / Dispatch carton packing), since a
 * user has no reason to trigger those manually and doing so would risk a
 * second, disconnected barcode for an entity that already has one.
 */
export const generateBarcodeSchema = z.object({
  entityType: z.enum(MANUALLY_GENERATABLE_ENTITY_TYPES),
  entityId: z.string().uuid(),
});
export type GenerateBarcodeInput = z.infer<typeof generateBarcodeSchema>;

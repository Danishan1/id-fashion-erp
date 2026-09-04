-- Lets a WarehouseLocation be tagged for a production stage (WIP/Finished
-- Goods/Dispatch/Reject), not just a raw-material sub-category -- mirrors 4
-- of WarehouseType's own 7 values. Product's own materialCategory (an
-- actual raw material's type) is unaffected -- its Zod schema still only
-- allows the original 9 values; only WarehouseLocation's Zod schema
-- (LOCATION_MATERIAL_CATEGORIES) accepts these new ones.

-- AlterEnum
ALTER TYPE "MaterialCategory" ADD VALUE 'WIP';
ALTER TYPE "MaterialCategory" ADD VALUE 'FINISHED_GOODS';
ALTER TYPE "MaterialCategory" ADD VALUE 'DISPATCH';
ALTER TYPE "MaterialCategory" ADD VALUE 'REJECT';

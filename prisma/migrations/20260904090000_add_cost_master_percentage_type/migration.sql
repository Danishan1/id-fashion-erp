-- Adds a "Percentage" Cost Master type (e.g. "5" means 5% of order value).
-- Reuses the existing `rate` Decimal column as-is -- the percentage meaning
-- comes from this type tag alone, no new column needed.

-- AlterEnum
ALTER TYPE "CostMasterType" ADD VALUE 'PERCENTAGE';

-- AlterTable
ALTER TABLE "replicate_design_compatibility_checks" ADD COLUMN     "overall_suggestion" TEXT;

-- AlterTable
ALTER TABLE "replicate_design_compatibility_items" ADD COLUMN     "ai_suggestion" TEXT;

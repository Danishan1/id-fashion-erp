-- CreateEnum
CREATE TYPE "AiDesignerTechPackApprovalStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "ai_tech_pack_pages" ADD COLUMN     "technical_flat_attachment_id" TEXT,
ALTER COLUMN "prompt_text" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ai_tech_packs" ADD COLUMN     "approval_status" "AiDesignerTechPackApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "original_garment_analysis_json" JSONB,
ADD COLUMN     "parent_tech_pack_id" UUID,
ADD COLUMN     "revision_number" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "ai_tech_packs" ADD CONSTRAINT "ai_tech_packs_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tech_packs" ADD CONSTRAINT "ai_tech_packs_parent_tech_pack_id_fkey" FOREIGN KEY ("parent_tech_pack_id") REFERENCES "ai_tech_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

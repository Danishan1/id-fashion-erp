-- CreateEnum
CREATE TYPE "ReplicateDesignVersionApprovalStatus" AS ENUM ('DRAFT', 'AI_MODIFIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "ReplicatePromptType" ADD VALUE 'IMAGE_EDIT';

-- AlterTable
ALTER TABLE "replicate_design_generations" ADD COLUMN     "edited_feature" TEXT,
ADD COLUMN     "parent_image_id" UUID;

-- AlterTable
ALTER TABLE "replicate_design_versions" ADD COLUMN     "ai_prompt_id" UUID,
ADD COLUMN     "approval_status" "ReplicateDesignVersionApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "technical_changes_json" JSONB;

-- AddForeignKey
ALTER TABLE "replicate_design_generations" ADD CONSTRAINT "replicate_design_generations_parent_image_id_fkey" FOREIGN KEY ("parent_image_id") REFERENCES "replicate_design_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replicate_design_versions" ADD CONSTRAINT "replicate_design_versions_ai_prompt_id_fkey" FOREIGN KEY ("ai_prompt_id") REFERENCES "replicate_design_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


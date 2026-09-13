-- CreateEnum
CREATE TYPE "AiDesignerVersionApprovalStatus" AS ENUM ('DRAFT', 'AI_MODIFIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ai_versions" ADD COLUMN     "ai_prompt_id" UUID,
ADD COLUMN     "approval_status" "AiDesignerVersionApprovalStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "technical_changes_json" JSONB;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_versions" ADD CONSTRAINT "ai_versions_ai_prompt_id_fkey" FOREIGN KEY ("ai_prompt_id") REFERENCES "ai_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

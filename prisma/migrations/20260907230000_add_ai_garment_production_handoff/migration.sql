
-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "production_handoff_completed_at" TIMESTAMP(3),
ADD COLUMN     "production_handoff_completed_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_production_handoff_completed_by_user_i_fkey" FOREIGN KEY ("production_handoff_completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


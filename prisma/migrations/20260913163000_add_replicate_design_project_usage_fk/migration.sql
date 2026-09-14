
-- AlterTable
ALTER TABLE "ai_provider_usage" ADD COLUMN     "replicate_design_project_id" UUID;

-- AddForeignKey
ALTER TABLE "ai_provider_usage" ADD CONSTRAINT "ai_provider_usage_replicate_design_project_id_fkey" FOREIGN KEY ("replicate_design_project_id") REFERENCES "replicate_design_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;


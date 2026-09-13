-- AlterEnum
ALTER TYPE "AIProviderCapability" ADD VALUE 'MULTI_FABRIC';
ALTER TYPE "AIProviderCapability" ADD VALUE 'TECHNICAL_FLAT';

-- AlterTable
ALTER TABLE "ai_projects" ADD COLUMN     "second_fabric_apply_areas" TEXT[],
ADD COLUMN     "second_fabric_image_attachment_id" TEXT;

-- CreateTable
CREATE TABLE "ai_tech_packs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "status" "AiDesignerRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "flat_sketch_image_attachment_id" TEXT,
    "measurements_json" JSONB,
    "bom_json" JSONB,
    "error_message" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tech_packs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ai_tech_packs" ADD CONSTRAINT "ai_tech_packs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tech_packs" ADD CONSTRAINT "ai_tech_packs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tech_packs" ADD CONSTRAINT "ai_tech_packs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

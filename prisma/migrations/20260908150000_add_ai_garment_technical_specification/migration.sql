-- CreateEnum
CREATE TYPE "AiGarmentTechnicalSpecificationDecision" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "ai_garment_projects" ADD COLUMN     "approved_technical_specification_at" TIMESTAMP(3),
ADD COLUMN     "approved_technical_specification_by_user_id" UUID,
ADD COLUMN     "approved_technical_specification_id" UUID;

-- CreateTable
CREATE TABLE "ai_garment_technical_specification_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "additional_notes" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "status" "AiGarmentAnalysisRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error_category" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,

    CONSTRAINT "ai_garment_technical_specification_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_technical_specifications" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "design_direction_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "general_notes" TEXT,
    "decision" "AiGarmentTechnicalSpecificationDecision" NOT NULL DEFAULT 'PENDING',
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_technical_specifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_measurement_points" (
    "id" UUID NOT NULL,
    "technical_specification_id" UUID NOT NULL,
    "measurement_name" TEXT NOT NULL,
    "how_to_measure" TEXT,
    "tolerance_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_garment_measurement_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_garment_measurement_values" (
    "id" UUID NOT NULL,
    "measurement_point_id" UUID NOT NULL,
    "size_id" UUID NOT NULL,
    "ai_value_text" TEXT NOT NULL,
    "approved_value_text" TEXT NOT NULL,
    "user_edited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_garment_measurement_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_garment_technical_specification_runs_project_id_status_idx" ON "ai_garment_technical_specification_runs"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_technical_specifications_run_id_key" ON "ai_garment_technical_specifications"("run_id");

-- CreateIndex
CREATE INDEX "ai_garment_technical_specifications_design_direction_id_dec_idx" ON "ai_garment_technical_specifications"("design_direction_id", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "ai_garment_measurement_values_measurement_point_id_size_id_key" ON "ai_garment_measurement_values"("measurement_point_id", "size_id");

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_approved_technical_specification_id_fkey" FOREIGN KEY ("approved_technical_specification_id") REFERENCES "ai_garment_technical_specifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_projects" ADD CONSTRAINT "ai_garment_projects_approved_technical_specification_by_us_fkey" FOREIGN KEY ("approved_technical_specification_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specification_runs" ADD CONSTRAINT "ai_garment_technical_specification_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specification_runs" ADD CONSTRAINT "ai_garment_technical_specification_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specification_runs" ADD CONSTRAINT "ai_garment_technical_specification_runs_design_direction_i_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specification_runs" ADD CONSTRAINT "ai_garment_technical_specification_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specifications" ADD CONSTRAINT "ai_garment_technical_specifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specifications" ADD CONSTRAINT "ai_garment_technical_specifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_garment_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specifications" ADD CONSTRAINT "ai_garment_technical_specifications_design_direction_id_fkey" FOREIGN KEY ("design_direction_id") REFERENCES "ai_garment_design_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specifications" ADD CONSTRAINT "ai_garment_technical_specifications_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_garment_technical_specification_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_technical_specifications" ADD CONSTRAINT "ai_garment_technical_specifications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_measurement_points" ADD CONSTRAINT "ai_garment_measurement_points_technical_specification_id_fkey" FOREIGN KEY ("technical_specification_id") REFERENCES "ai_garment_technical_specifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_measurement_values" ADD CONSTRAINT "ai_garment_measurement_values_measurement_point_id_fkey" FOREIGN KEY ("measurement_point_id") REFERENCES "ai_garment_measurement_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_garment_measurement_values" ADD CONSTRAINT "ai_garment_measurement_values_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

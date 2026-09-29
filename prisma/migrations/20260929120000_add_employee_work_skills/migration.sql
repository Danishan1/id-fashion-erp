
-- CreateTable
CREATE TABLE "employee_work_skills" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_work_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_work_skills_production_stage_id_idx" ON "employee_work_skills"("production_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_work_skills_employee_id_production_stage_id_key" ON "employee_work_skills"("employee_id", "production_stage_id");

-- AddForeignKey
ALTER TABLE "employee_work_skills" ADD CONSTRAINT "employee_work_skills_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_work_skills" ADD CONSTRAINT "employee_work_skills_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


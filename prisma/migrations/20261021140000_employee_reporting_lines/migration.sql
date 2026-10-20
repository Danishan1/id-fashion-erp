-- CreateEnum
CREATE TYPE "HierarchyModule" AS ENUM ('PRODUCTION', 'CRM', 'HRMS');

-- CreateTable
CREATE TABLE "employee_reporting_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "manager_id" UUID NOT NULL,
    "module" "HierarchyModule" NOT NULL,
    "start_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_reporting_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_reporting_lines_company_id_module_manager_id_idx" ON "employee_reporting_lines"("company_id", "module", "manager_id");

-- CreateIndex
CREATE INDEX "employee_reporting_lines_employee_id_module_idx" ON "employee_reporting_lines"("employee_id", "module");

-- AddForeignKey
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_reporting_lines" ADD CONSTRAINT "employee_reporting_lines_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- P3: at most one active line per employee per module, and no self-reporting.
CREATE UNIQUE INDEX "employee_reporting_lines_one_active_per_module"
  ON "employee_reporting_lines" ("employee_id", "module") WHERE "is_active";
ALTER TABLE "employee_reporting_lines"
  ADD CONSTRAINT "employee_reporting_lines_not_self" CHECK ("employee_id" <> "manager_id");

-- P3: HRMS team scoping. Users without hrms_*.view_all see only themselves
-- and their HRMS team. Every role that can see HRMS today keeps seeing
-- everything (remove view_all from a role to limit it to its team).
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
VALUES
  (gen_random_uuid(), 'hrms_leave.view_all', 'hrms_leave', 'view_all access for hrms_leave', NOW()),
  (gen_random_uuid(), 'hrms_attendance.view_all', 'hrms_attendance', 'view_all access for hrms_attendance', NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", va."id", NOW()
FROM "role_permissions" rp
JOIN "permissions" v ON v."id" = rp."permission_id" AND v."key" IN ('hrms_leave.view', 'hrms_attendance.view')
JOIN "permissions" va ON va."key" = v."module" || '.view_all'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- CreateEnum
CREATE TYPE "SalaryStatutoryKind" AS ENUM ('PF', 'ESIC');

-- CreateEnum
CREATE TYPE "SalaryComponentKind" AS ENUM ('ALLOWANCE', 'DEDUCTION');


-- CreateTable
CREATE TABLE "hrms_salary_statutory_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "SalaryStatutoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "employer_rate" DECIMAL(5,2) NOT NULL,
    "employee_rate" DECIMAL(5,2) NOT NULL,
    "max_limit" DECIMAL(18,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_salary_statutory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_employee_salary_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "base_monthly_salary" DECIMAL(18,2) NOT NULL,
    "pf_setting_id" UUID,
    "esic_setting_id" UUID,
    "pan_number" TEXT,
    "uan_number" TEXT,
    "esic_number" TEXT,
    "tds_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "surcharge_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "education_cess" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "late_fee_interest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "bank_ifsc" TEXT,
    "bank_branch" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hrms_employee_salary_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_employee_salary_components" (
    "id" UUID NOT NULL,
    "setting_id" UUID NOT NULL,
    "kind" "SalaryComponentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "hrms_employee_salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hrms_salary_statutory_settings_company_id_kind_title_key" ON "hrms_salary_statutory_settings"("company_id", "kind", "title");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_employee_salary_settings_employee_id_key" ON "hrms_employee_salary_settings"("employee_id");

-- CreateIndex
CREATE INDEX "hrms_employee_salary_settings_company_id_idx" ON "hrms_employee_salary_settings"("company_id");

-- CreateIndex
CREATE INDEX "hrms_employee_salary_components_setting_id_idx" ON "hrms_employee_salary_components"("setting_id");

-- AddForeignKey
ALTER TABLE "hrms_salary_statutory_settings" ADD CONSTRAINT "hrms_salary_statutory_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_salary_settings" ADD CONSTRAINT "hrms_employee_salary_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_salary_settings" ADD CONSTRAINT "hrms_employee_salary_settings_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_salary_settings" ADD CONSTRAINT "hrms_employee_salary_settings_pf_setting_id_fkey" FOREIGN KEY ("pf_setting_id") REFERENCES "hrms_salary_statutory_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_salary_settings" ADD CONSTRAINT "hrms_employee_salary_settings_esic_setting_id_fkey" FOREIGN KEY ("esic_setting_id") REFERENCES "hrms_salary_statutory_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_employee_salary_components" ADD CONSTRAINT "hrms_employee_salary_components_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "hrms_employee_salary_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added checks
ALTER TABLE "hrms_salary_statutory_settings" ADD CONSTRAINT "hrms_salary_statutory_rates_check"
  CHECK ("employer_rate" BETWEEN 0 AND 100 AND "employee_rate" BETWEEN 0 AND 100 AND ("max_limit" IS NULL OR "max_limit" >= 0));
ALTER TABLE "hrms_employee_salary_settings" ADD CONSTRAINT "hrms_employee_salary_amounts_check"
  CHECK ("base_monthly_salary" >= 0 AND "tds_amount" >= 0 AND "surcharge_amount" >= 0 AND "education_cess" >= 0 AND "late_fee_interest" >= 0);
ALTER TABLE "hrms_employee_salary_components" ADD CONSTRAINT "hrms_employee_salary_component_amount_check" CHECK ("amount" >= 0);

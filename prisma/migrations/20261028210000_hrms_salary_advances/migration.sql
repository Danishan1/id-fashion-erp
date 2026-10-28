-- AlterEnum
ALTER TYPE "PaymentRequestType" ADD VALUE 'SALARY_ADVANCE';

ALTER TABLE "hrms_salary_run_lines" ADD COLUMN     "installment_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "installment_json" JSONB;


-- CreateTable
CREATE TABLE "hrms_salary_advances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "installments" INTEGER NOT NULL,
    "installment_amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_salary_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hrms_salary_advance_recoveries" (
    "id" UUID NOT NULL,
    "advance_id" UUID NOT NULL,
    "run_line_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hrms_salary_advance_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hrms_salary_advances_payment_request_id_key" ON "hrms_salary_advances"("payment_request_id");

-- CreateIndex
CREATE INDEX "hrms_salary_advances_company_id_employee_id_idx" ON "hrms_salary_advances"("company_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hrms_salary_advance_recoveries_advance_id_run_line_id_key" ON "hrms_salary_advance_recoveries"("advance_id", "run_line_id");

-- AddForeignKey
ALTER TABLE "hrms_salary_advances" ADD CONSTRAINT "hrms_salary_advances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_advances" ADD CONSTRAINT "hrms_salary_advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_advances" ADD CONSTRAINT "hrms_salary_advances_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_advance_recoveries" ADD CONSTRAINT "hrms_salary_advance_recoveries_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "hrms_salary_advances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hrms_salary_advance_recoveries" ADD CONSTRAINT "hrms_salary_advance_recoveries_run_line_id_fkey" FOREIGN KEY ("run_line_id") REFERENCES "hrms_salary_run_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added checks
ALTER TABLE "hrms_salary_advances" ADD CONSTRAINT "hrms_salary_advances_amounts_check" CHECK ("amount" > 0 AND "installments" BETWEEN 1 AND 60 AND "installment_amount" > 0);
ALTER TABLE "hrms_salary_advance_recoveries" ADD CONSTRAINT "hrms_salary_advance_recoveries_amount_check" CHECK ("amount" > 0);
ALTER TABLE "hrms_salary_run_lines" ADD CONSTRAINT "hrms_salary_run_lines_installment_check" CHECK ("installment_amount" >= 0);

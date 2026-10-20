-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'JOB_ORDER';

-- CreateTable
CREATE TABLE "production_handbacks" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "job_order_id" UUID NOT NULL,
    "job_order_assignment_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "assigned_quantity_before" DECIMAL(18,4) NOT NULL,
    "handed_back_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_handbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_handbacks_job_order_id_idx" ON "production_handbacks"("job_order_id");

-- CreateIndex
CREATE INDEX "production_handbacks_job_order_assignment_id_idx" ON "production_handbacks"("job_order_assignment_id");

-- CreateIndex
CREATE INDEX "production_handbacks_company_id_created_at_idx" ON "production_handbacks"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_job_order_id_fkey" FOREIGN KEY ("job_order_id") REFERENCES "job_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_job_order_assignment_id_fkey" FOREIGN KEY ("job_order_assignment_id") REFERENCES "job_order_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_handed_back_by_user_id_fkey" FOREIGN KEY ("handed_back_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- P4: a hand-back is always a positive quantity.
ALTER TABLE "production_handbacks" ADD CONSTRAINT "production_handbacks_quantity_positive" CHECK ("quantity" > 0);

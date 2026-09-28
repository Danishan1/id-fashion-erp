-- Production costing & worker rules (2026-09-28):
--  * Contractor multi-stage selection (contractor_stages)
--  * Worker assignment expected time window
--  * Cutting-style extra pieces (allows_extra_quantity / extra_quantity)
--  * Style -> Design -> Job Work stage-wise costing (style/design stage costs,
--    multi-stage job work covered stages + extra charges + frozen totals)
-- Every change is additive/nullable; existing rows stay valid.

-- CreateEnum
CREATE TYPE "StageCostSource" AS ENUM ('STYLE_DEFAULT', 'DESIGN_OVERRIDE', 'NOT_CONFIGURED');

-- AlterTable
ALTER TABLE "job_order_assignments" ADD COLUMN     "expected_end_at" TIMESTAMP(3),
ADD COLUMN     "expected_start_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "job_order_progress_entries" ADD COLUMN     "extra_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "job_orders" ADD COLUMN     "extra_quantity" DECIMAL(18,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "job_work_orders" ADD COLUMN     "extra_cost_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "finished_goods_warehouse_id" UUID,
ADD COLUMN     "stage_cost_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_cost" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "production_stages" ADD COLUMN     "allows_extra_quantity" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "contractor_stages" (
    "id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_stage_costs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "style_stage_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_stage_costs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "sample_request_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "cost" DECIMAL(18,4) NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_stage_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_order_stages" (
    "id" UUID NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "default_rate" DECIMAL(18,4),
    "default_source" "StageCostSource" NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "is_overridden" BOOLEAN NOT NULL DEFAULT false,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_work_order_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_work_order_extra_charges" (
    "id" UUID NOT NULL,
    "job_work_order_id" UUID NOT NULL,
    "cost_type" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_work_order_extra_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_stages_production_stage_id_idx" ON "contractor_stages"("production_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "contractor_stages_contractor_id_production_stage_id_key" ON "contractor_stages"("contractor_id", "production_stage_id");

-- CreateIndex
CREATE INDEX "style_stage_costs_company_id_idx" ON "style_stage_costs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "style_stage_costs_product_id_production_stage_id_key" ON "style_stage_costs"("product_id", "production_stage_id");

-- CreateIndex
CREATE INDEX "design_stage_costs_company_id_idx" ON "design_stage_costs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_stage_costs_sample_request_id_production_stage_id_key" ON "design_stage_costs"("sample_request_id", "production_stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_work_order_stages_job_work_order_id_production_stage_id_key" ON "job_work_order_stages"("job_work_order_id", "production_stage_id");

-- CreateIndex
CREATE INDEX "job_work_order_extra_charges_job_work_order_id_idx" ON "job_work_order_extra_charges"("job_work_order_id");

-- AddForeignKey
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_finished_goods_warehouse_id_fkey" FOREIGN KEY ("finished_goods_warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_stages" ADD CONSTRAINT "contractor_stages_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_stages" ADD CONSTRAINT "contractor_stages_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_stage_costs" ADD CONSTRAINT "style_stage_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_stage_costs" ADD CONSTRAINT "style_stage_costs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_stage_costs" ADD CONSTRAINT "style_stage_costs_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_stage_costs" ADD CONSTRAINT "design_stage_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_stage_costs" ADD CONSTRAINT "design_stage_costs_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_stage_costs" ADD CONSTRAINT "design_stage_costs_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_stages" ADD CONSTRAINT "job_work_order_stages_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_stages" ADD CONSTRAINT "job_work_order_stages_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_work_order_extra_charges" ADD CONSTRAINT "job_work_order_extra_charges_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "job_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extra pieces widen the job order's capacity explicitly and auditably.
ALTER TABLE "job_orders" DROP CONSTRAINT IF EXISTS "job_orders_quantity_consistency_check";
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_quantity_consistency_check"
  CHECK (completed_quantity + rejected_quantity + damaged_quantity <= planned_quantity + extra_quantity);
ALTER TABLE "job_orders" ADD CONSTRAINT "job_orders_extra_quantity_nonnegative_check" CHECK (extra_quantity >= 0);
ALTER TABLE "job_order_progress_entries" ADD CONSTRAINT "job_order_progress_entries_extra_quantity_nonnegative_check"
  CHECK (extra_quantity >= 0);

ALTER TABLE "style_stage_costs" ADD CONSTRAINT "style_stage_costs_cost_nonnegative_check" CHECK (cost >= 0);
ALTER TABLE "design_stage_costs" ADD CONSTRAINT "design_stage_costs_cost_nonnegative_check" CHECK (cost >= 0);
ALTER TABLE "job_work_order_stages" ADD CONSTRAINT "job_work_order_stages_nonnegative_check"
  CHECK (rate >= 0 AND amount >= 0 AND quantity > 0);
ALTER TABLE "job_work_order_extra_charges" ADD CONSTRAINT "job_work_order_extra_charges_amount_nonnegative_check"
  CHECK (amount >= 0);
ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_total_cost_check"
  CHECK (total_cost = stage_cost_total + extra_cost_total);

-- Backfill: every pre-existing job-work order covered exactly its own source
-- stage. Record that as one covered-stage row so "a job-work order always has
-- >= 1 covered stage" holds for old and new rows alike. Rate comes from the
-- old piece-rate snapshot if any, else 0; source NOT_CONFIGURED (never
-- invented).
INSERT INTO "job_work_order_stages"
  ("id", "job_work_order_id", "production_stage_id", "sequence", "quantity", "default_rate", "default_source", "rate", "is_overridden", "amount")
SELECT gen_random_uuid(), jwo."id", jo."production_stage_id", 0, jwo."issued_quantity",
       jwo."resolved_rate", 'NOT_CONFIGURED', COALESCE(jwo."resolved_rate", 0), false,
       ROUND(COALESCE(jwo."resolved_rate", 0) * jwo."issued_quantity", 2)
FROM "job_work_orders" jwo
JOIN "job_orders" jo ON jo."id" = jwo."job_order_id"
WHERE jwo."issued_quantity" > 0;

UPDATE "job_work_orders" jwo
SET "stage_cost_total" = s."amount", "total_cost" = s."amount"
FROM "job_work_order_stages" s
WHERE s."job_work_order_id" = jwo."id";

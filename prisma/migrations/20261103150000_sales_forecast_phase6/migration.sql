-- Sales & Marketing Phase 06 — sales forecasting (2026-11-03).
-- Forecast snapshots (manual + one automatic per company and period),
-- saved what-if scenarios, and forecast settings (default quotation
-- probabilities by status, trend look-back, stale days). Permissions reuse
-- the Phase 05 "sales_performance" module — no new permission rows.
-- Doc: docs/sales-marketing/PHASE_06_FORECAST.md
-- Rollback: prisma/rollback/20261103150000_sales_forecast_phase6.down.sql

-- CreateEnum
CREATE TYPE "SalesForecastSnapshotKind" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable: settings
ALTER TABLE "sales_marketing_settings"
    ADD COLUMN "forecast_probability_approved" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "forecast_probability_issued" INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN "forecast_probability_accepted" INTEGER NOT NULL DEFAULT 90,
    ADD COLUMN "forecast_trend_lookback" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "forecast_stale_days" INTEGER NOT NULL DEFAULT 60,
    ADD CONSTRAINT "sales_marketing_settings_forecast_check" CHECK (
          "forecast_probability_approved" BETWEEN 0 AND 100
      AND "forecast_probability_issued" BETWEEN 0 AND 100
      AND "forecast_probability_accepted" BETWEEN 0 AND 100
      AND "forecast_trend_lookback" BETWEEN 1 AND 24
      AND "forecast_stale_days" BETWEEN 1 AND 3650
    );

-- CreateTable
CREATE TABLE "sales_forecast_snapshots" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "kind" "SalesForecastSnapshotKind" NOT NULL,
    "period_type" "SalesTargetPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_forecast_snapshots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_forecast_snapshots_period_check" CHECK ("period_end" >= "period_start"),
    -- Manual snapshots name who took them; automatic ones don't.
    CONSTRAINT "sales_forecast_snapshots_creator_check" CHECK (("kind" = 'MANUAL') = ("created_by_user_id" IS NOT NULL))
);

CREATE TABLE "sales_forecast_scenarios" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "period_type" "SalesTargetPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "last_result" JSONB,
    "last_calculated_at" TIMESTAMP(3),
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_forecast_scenarios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_forecast_scenarios_period_check" CHECK ("period_end" >= "period_start")
);

-- CreateIndex
CREATE INDEX "sales_forecast_snapshots_company_period_idx" ON "sales_forecast_snapshots"("company_id", "period_type", "period_start");
CREATE INDEX "sales_forecast_scenarios_company_id_period_start_idx" ON "sales_forecast_scenarios"("company_id", "period_start");
-- One automatic snapshot per company and period, so worker retries never duplicate it (SQL only).
CREATE UNIQUE INDEX "sales_forecast_snapshots_one_auto_per_period" ON "sales_forecast_snapshots" ("company_id", "period_type", "period_start") WHERE "kind" = 'AUTO';

-- AddForeignKey
ALTER TABLE "sales_forecast_snapshots" ADD CONSTRAINT "sales_forecast_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_forecast_snapshots" ADD CONSTRAINT "sales_forecast_snapshots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales_forecast_scenarios" ADD CONSTRAINT "sales_forecast_scenarios_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_forecast_scenarios" ADD CONSTRAINT "sales_forecast_scenarios_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_forecast_scenarios" ADD CONSTRAINT "sales_forecast_scenarios_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

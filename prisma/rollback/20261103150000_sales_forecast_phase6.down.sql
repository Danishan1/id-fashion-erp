-- Rollback for 20261103150000_sales_forecast_phase6. Run before the Phase 05 down script.
-- Loses forecast snapshots, scenarios and the forecast settings (business data untouched).
BEGIN;
DROP TABLE IF EXISTS "sales_forecast_scenarios";
DROP TABLE IF EXISTS "sales_forecast_snapshots";
ALTER TABLE "sales_marketing_settings"
    DROP CONSTRAINT IF EXISTS "sales_marketing_settings_forecast_check",
    DROP COLUMN IF EXISTS "forecast_probability_approved",
    DROP COLUMN IF EXISTS "forecast_probability_issued",
    DROP COLUMN IF EXISTS "forecast_probability_accepted",
    DROP COLUMN IF EXISTS "forecast_trend_lookback",
    DROP COLUMN IF EXISTS "forecast_stale_days";
DROP TYPE IF EXISTS "SalesForecastSnapshotKind";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103150000_sales_forecast_phase6';
COMMIT;
